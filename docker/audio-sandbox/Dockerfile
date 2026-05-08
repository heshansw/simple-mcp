# Stage 1: Build whisper.cpp from source
FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Clone and build whisper.cpp (pinned to a stable release)
ARG WHISPER_CPP_VERSION=v1.7.4
RUN git clone --depth 1 --branch ${WHISPER_CPP_VERSION} \
    https://github.com/ggerganov/whisper.cpp.git /build/whisper.cpp

WORKDIR /build/whisper.cpp

# Disable native CPU detection — Docker's emulation layer doesn't expose
# the real CPU features, causing -mcpu=native to fail on ARM.
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=OFF \
    -DGGML_CPU_ARM_ARCH="" \
    && cmake --build build --config Release -j$(nproc) \
    && cp build/bin/whisper-cli /usr/local/bin/whisper-cli

# Stage 2: Runtime image with ffmpeg + whisper-cli
FROM ubuntu:24.04 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libavcodec-extra \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled whisper-cli binary and shared libraries
COPY --from=builder /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=builder /build/whisper.cpp/build/src/libwhisper.so* /usr/local/lib/
COPY --from=builder /build/whisper.cpp/build/ggml/src/libggml*.so* /usr/local/lib/
RUN ldconfig

# Create mount points for audio files and models
RUN mkdir -p /data/audio /data/models

# Download Whisper model at build time (no host-side curl needed)
ARG WHISPER_MODEL=small
RUN curl -L -o /data/models/ggml-${WHISPER_MODEL}.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin

# Non-root user for security
RUN groupadd -r audioproc && useradd -r -g audioproc -d /data audioproc
RUN chown -R audioproc:audioproc /data
USER audioproc

# Keep container alive for docker exec
ENTRYPOINT ["tail", "-f", "/dev/null"]
