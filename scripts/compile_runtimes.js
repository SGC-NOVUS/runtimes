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

async function fileExists(filePath) {
    try { await fs.access(filePath); return true; } catch { return false; }
}

async function generateBaseData(dockerfileContent, attempt = 1) {
    const prompt = `
You are a senior DevOps and AI analyzer.
Analyze this Dockerfile used for a game server runtime. 
Extract the core components (OS base, packages like java, python, curl, etc.) and create a catchy title and professional description.
Also, perform a Health Check. If you find outdated base images (like debian:bullseye-slim instead of bookworm) or old dependencies, flag them in a "warnings" array.

Return EXACTLY a JSON object with this schema:
{
  "name": "Catchy Title (e.g., Debian Java Runtime)",
  "description": "Professional description of what this runtime provides...",
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
            return generateBaseData(dockerfileContent, attempt + 1);
        }
        throw e;
    }
}

async function translateData(payload, langCode, attempt = 1) {
    const prompt = `
Translate the following JSON object into "${langCode}".
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
        const hash = crypto.createHash('md5').update(dockerfileContent).digest('hex');
        
        let runtimeInfo = cache.runtimes[dir.name];
        
        if (!runtimeInfo || runtimeInfo.hash !== hash) {
            console.log(`[AI] Generating description and components for ${dir.name}...`);
            const baseData = await generateBaseData(dockerfileContent);
            
            if (baseData.warnings && baseData.warnings.length > 0) {
                console.warn(`\n[WARNING] AI Health Check for ${dir.name} indicates outdated components:`);
                baseData.warnings.forEach(w => console.warn(` - ${w}`));
                console.warn('');
            }
            
            runtimeInfo = {
                hash,
                name: baseData.name,
                description: baseData.description,
                components: baseData.components || [],
                locales: {}
            };
            
            for (const lang of targetLangs) {
                console.log(`[AI] Translating to ${lang}...`);
                const payload = { name: runtimeInfo.name, description: runtimeInfo.description };
                const translated = await translateData(payload, lang);
                runtimeInfo.locales[lang] = translated;
            }
            
            cache.runtimes[dir.name] = runtimeInfo;
            await fs.writeFile(cachePath, JSON.stringify(cache, null, 4));
        } else {
            console.log(`[CACHE] Used cached data for ${dir.name}`);
        }
        
        const iconName = `${dir.name}.webp`;
        const cleanRelativePath = encodeURIComponent(dir.name);
        const iconUrl = `${CUSTOM_DOMAIN}/${cleanRelativePath}/${iconName}`;
        const fallbackIconUrl = `https://raw.githubusercontent.com/${REPO_OWNER_NAME}/${BRANCH}/${cleanRelativePath}/${iconName}`;
        
        const pullCmd = `docker pull ghcr.io/sgc-novus/core-images:${dir.name}`;
        
        runtimesData.push({
            id: dir.name,
            tag: dir.name,
            pullCmd,
            iconUrl,
            fallbackIconUrl,
            components: runtimeInfo.components,
            locales: {
                en: { name: runtimeInfo.name, description: runtimeInfo.description },
                ...runtimeInfo.locales
            }
        });
    }
    
    const outJsonPath = path.join(ROOT_DIR, 'runtimes.json');
    await fs.writeFile(outJsonPath, JSON.stringify(runtimesData, null, 4));
    console.log(`\n[SUCCESS] Wrote runtimes.json with ${runtimesData.length} runtimes.`);
}

main().catch(console.error);
