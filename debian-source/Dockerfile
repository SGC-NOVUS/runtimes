FROM debian:bookworm-slim

LABEL maintainer="SGC-NOVUS Tech"
LABEL org.opencontainers.image.source="https://github.com/sgc-novus/core-images"

ENV DEBIAN_FRONTEND=noninteractive

# Устанавливаем системные зависимости и 32-битную архитектуру
RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        tar \
        unzip \
        jq \
        git \
        build-essential \
        lib32gcc-s1 \
        lib32stdc++6 \
        libtinfo6:i386 \
        libcurl4-gnutls-dev:i386 \
        libmariadb3:i386 \
        libsdl2-2.0-0:i386 \
        libicu-dev \
        locales && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    localedef -i en_US -c -f UTF-8 -A /usr/share/locale/locale.alias en_US.UTF-8

ENV LANG=en_US.utf8

# Создаем пользователя для работы контейнера
RUN useradd -m -d /home/container -s /bin/bash container
USER container
ENV USER=container HOME=/home/container
WORKDIR /home/container

CMD ["/bin/bash"]
