package com.example.demo;

import com.common.kafka.KafkaClient;
import com.common.kafka.KafkaConfig;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.core.KafkaTemplate;

@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }

    @Bean
    public CommandLineRunner loadData(UserRepository repository) {
        return args -> {
            if (repository.count() == 0) {
                repository.save(new User(1L, "Alice", "alice@ecommerce.com"));
                repository.save(new User(2L, "Bob", "bob@ecommerce.com"));
                System.out.println("Mock Users loaded into PostgreSQL!");
            }
        };
    }

    @Bean
    public KafkaConfig kafkaConfig() {
        return new KafkaConfig()
                .setClusterId("e-commerce")
                .setNodeId("user-service");
    }

    @Bean
    public KafkaClient kafkaClient(KafkaConfig config, KafkaTemplate<String, String> template) {
        return new KafkaClient(config, template);
    }
}
