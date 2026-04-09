FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
# Copy the common project first
COPY common-java /app/common-java
WORKDIR /app/common-java
RUN mvn clean install -DskipTests

# Copy and build the target project
WORKDIR /app/service-b
COPY service-b/pom.xml .
COPY service-b/src ./src
RUN mvn clean package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/service-b/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
