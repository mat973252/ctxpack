FROM node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS node-runtime
FROM maven@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS tools
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/maven-home/wrapper/dists/apache-maven-3.9.11 /opt/maven-repository \
    && ln -s /usr/share/maven /opt/maven-home/wrapper/dists/apache-maven-3.9.11/a2d47e15 \
    && printf '<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0"/>\n' > /opt/empty-settings.xml \
    && chown -R 1000:1000 /opt/maven-repository
ENV CI=true HOME=/opt/maven-home MAVEN_USER_HOME=/opt/maven-home MAVEN_CONFIG=/opt/maven-home
ENTRYPOINT []
WORKDIR /workspace

# Prepare public dependencies in a fresh cache, never copy the host's .m2/settings.
# Excluding the known-red class here only warms dependencies; this is not acceptance.
FROM tools AS dependencies
COPY --chown=1000:1000 workspace/ /workspace/
RUN chown 1000:1000 /workspace
USER 1000:1000
RUN sh ./mvnw --version \
    && sh ./mvnw -B -ntp -s /opt/empty-settings.xml -gs /opt/empty-settings.xml \
      -Dmaven.repo.local=/opt/maven-repository '-Dtest=!GuardedToolMethodsAcceptanceTest' \
      -Dsurefire.failIfNoSpecifiedTests=false clean verify

FROM tools
COPY --from=dependencies /opt/maven-repository/ /opt/maven-repository/
COPY --chown=1000:1000 workspace/ /workspace/
RUN chown 1000:1000 /workspace
USER 1000:1000
RUN git init -q -b mat/recovery-case \
    && git config user.name 'Recovery fixture' \
    && git config user.email fixture@example.invalid \
    && git add --all && git commit -qm 'Baseline plus frozen recovery acceptance'
CMD ["sleep", "infinity"]
