FROM maven:3.9-eclipse-temurin-21-alpine AS build
WORKDIR /workspace
COPY backend/pom.xml ./pom.xml
COPY backend/src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl     && addgroup -S app     && adduser -S -G app app
WORKDIR /app
COPY --from=build /workspace/target/bajaj-dealership-api-0.1.0-SNAPSHOT.jar /app/app.jar
RUN mkdir -p /app/var/private-notification-media     && chown -R app:app /app
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/app.jar"]
