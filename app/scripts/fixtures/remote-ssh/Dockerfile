FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server python3 clangd git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd /root/.ssh /workspace
RUN printf 'int value = 42;\nint main() { return value; }\n' > /workspace/main.cpp \
    && git -C /workspace init
COPY sshd_config /etc/ssh/sshd_config
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
