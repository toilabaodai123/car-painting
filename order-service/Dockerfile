FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY common-java /app/common-java
WORKDIR /app/common-java
RUN mvn clean install -DskipTests

WORKDIR /app/order-service
COPY order-service/pom.xml .
COPY order-service/src ./src
RUN mvn clean package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/order-service/target/*.jar app.jar
CMD ["java", "-jar", "app.jar"]
