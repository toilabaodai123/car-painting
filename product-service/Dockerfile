FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
# Copy the common project first
COPY common-java /app/common-java
WORKDIR /app/common-java
RUN mvn clean install -DskipTests

# Copy and build the target project
WORKDIR /app/product-service
COPY product-service/pom.xml .
COPY product-service/src ./src
RUN mvn clean package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/product-service/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
