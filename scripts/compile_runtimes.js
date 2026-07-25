import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../');

const REPO_OWNER_NAME = 'SGC-NOVUS/runtimes';
const BRANCH = 'main';
const CUSTOM_DOMAIN = 'https://hub.sgc-novus.fun';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: 'gemini-3.5-flash-lite',
    generationConfig: { responseMimeType: "application/json" }
});

function getMD5(data) {
    return crypto.createHash('md5').update(data).digest('hex');
}

async function fileExists(filePath) {
    try { await fs.access(filePath); return true; } catch { return false; }
}

async function generateBaseData(dirName, dockerfileContent, attempt = 1) {
    const prompt = `
You are a senior DevOps engineer and technical writer.
Analyze this Dockerfile. The directory name for this image is "${dirName}".
IMPORTANT CONTEXT:
- If the directory name contains "bot" or "python", this image is intended for running companion bots (like Telegram/Discord bots), administration scripts, or panel orchestrators. Do NOT call it a "game server".
- If the directory name contains "source" or "java", it is intended as a base runtime for multiplayer game servers.

Extract the core components (OS base, packages like java, python, curl, etc.).
Create a catchy, professional title and a COMPREHENSIVE, detailed description (at least 3-4 sentences). The description should explain exactly what this image is tailored for, its performance benefits, and why a DevOps administrator would use it. Do NOT output a single sentence.
Also, perform a Health Check. If you find outdated base images (like debian:bullseye-slim instead of bookworm) or old dependencies, flag them in a "warnings" array.

Return EXACTLY a JSON object with this schema:
{
  "name": "Catchy Title (e.g., Enterprise Java Runtime)",
  "description": "Detailed, professional description of what this runtime provides...",
  "components": ["Debian Bullseye", "Java 17", "cURL", "Git"],
  "warnings": ["Array of strings describing outdated components, or empty if none"]
}

Dockerfile:
${dockerfileContent}
`;
    
    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().trim();
        text = text.replace(/```json/gi, '').replace(/```/gi, '').trim();
        return JSON.parse(text);
    } catch (e) {
        if (attempt < 3) {
            await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 1000));
            return generateBaseData(dirName, dockerfileContent, attempt + 1);
        }
        throw e;
    }
}

async function translateData(payload, langCode, attempt = 1) {
    const prompt = `
You are a professional IT and DevOps localizer. Translate the following JSON object into "${langCode}".
Make the translation sound natural, professional, and appealing to game server administrators. Avoid literal or "robotic" translations. Ensure grammatical correctness.
Keep technical terms (Debian, Java, cURL, Python) in English.
Return ONLY a valid JSON object with the exact same keys as the input.

Input:
${JSON.stringify(payload, null, 2)}
`;
    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().trim();
        text = text.replace(/```json/gi, '').replace(/```/gi, '').trim();
        return JSON.parse(text);
    } catch (e) {
        if (attempt < 3) {
            await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 1000));
            return translateData(payload, langCode, attempt + 1);
        }
        throw e;
    }
}

async function main() {
    console.log('[Runtimes Compiler] Started...');
    
    const langsPath = path.join(__dirname, 'languages.txt');
    let targetLangs = ['ru', 'uk'];
    if (await fileExists(langsPath)) {
        const langsRaw = await fs.readFile(langsPath, 'utf-8');
        targetLangs = langsRaw.split('\n').map(l => l.trim()).filter(l => l);
    }
    
    const cachePath = path.join(__dirname, 'translation_cache.json');
    let cache = { runtimes: {} };
    if (await fileExists(cachePath)) {
        try { cache = JSON.parse(await fs.readFile(cachePath, 'utf-8')); } catch(e) {}
    }
    if (!cache.runtimes) cache.runtimes = {};
    
    const rootDirs = await fs.readdir(ROOT_DIR, { withFileTypes: true });
    const runtimesData = [];
    
    for (const dir of rootDirs) {
        if (!dir.isDirectory() || dir.name.startsWith('.') || ['scripts', 'node_modules'].includes(dir.name)) continue;
        
        const dockerfilePath = path.join(ROOT_DIR, dir.name, 'Dockerfile');
        if (!(await fileExists(dockerfilePath))) continue;
        
        console.log(`\n⚙️  Analyzing ${dir.name}...`);
        const dockerfileContent = await fs.readFile(dockerfilePath, 'utf-8');
        const currentHash = getMD5(dockerfileContent);
        
        let baseData = null;
        const cacheEntry = cache.runtimes[dir.name];
        
        if (cacheEntry && cacheEntry.hash === currentHash) {
            console.log(`[CACHE] Base data for ${dir.name} is up to date.`);
            baseData = cacheEntry.data;
        } else {
            console.log(`[AI] Generating base data for ${dir.name}...`);
            baseData = await generateBaseData(dir.name, dockerfileContent);
            
            if (baseData.warnings && baseData.warnings.length > 0) {
                console.warn(`\n[WARNING] AI Health Check for ${dir.name} indicates outdated components:`);
                baseData.warnings.forEach(w => console.warn(` - ${w}`));
                console.warn('');
            }
            
            cache.runtimes[dir.name] = {
                hash: currentHash,
                data: baseData,
                locales: {}
            };
        }
        
        const runtimeInfo = cache.runtimes[dir.name];
        const translations = { ...runtimeInfo.locales };
        
        for (const lang of targetLangs) {
            if (!translations[lang]) {
                console.log(`[AI] Translating to ${lang}...`);
                const payload = { name: runtimeInfo.data.name, description: runtimeInfo.data.description };
                const translated = await translateData(payload, lang);
                translations[lang] = translated;
                runtimeInfo.locales[lang] = translated;
                await fs.writeFile(cachePath, JSON.stringify(cache, null, 4));
            } else {
                console.log(`[CACHE] Used cached translation for ${lang}`);
            }
        }
        
        const iconName = `${dir.name}.webp`;
        const tagMap = {
            'debian-source': 'source',
            'debian-java': 'java',
            'python-bot': 'python'
        };
        const tag = tagMap[dir.name] || dir.name;
        
        const pullCmd = `docker pull ghcr.io/sgc-novus/core-images:${tag}`;
        const iconUrl = `${CUSTOM_DOMAIN}/runtimes/${dir.name}/${iconName}`;
        const fallbackIconUrl = `https://raw.githubusercontent.com/${REPO_OWNER_NAME}/${BRANCH}/${dir.name}/${iconName}`;
        
        runtimesData.push({
            id: dir.name,
            tag: tag,
            pullCmd,
            iconUrl,
            fallbackIconUrl,
            components: runtimeInfo.data.components,
            locales: {
                en: { name: runtimeInfo.data.name, description: runtimeInfo.data.description },
                ...translations
            }
        });
    }
    
    const outJsonPath = path.join(ROOT_DIR, 'runtimes.json');
    await fs.writeFile(outJsonPath, JSON.stringify(runtimesData, null, 4));
    console.log(`\n[SUCCESS] Wrote runtimes.json with ${runtimesData.length} runtimes.`);
}

main().catch(console.error);
