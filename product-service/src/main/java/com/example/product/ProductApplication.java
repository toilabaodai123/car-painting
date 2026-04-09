package com.example.product;

import com.common.kafka.KafkaClient;
import com.common.kafka.KafkaConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.core.KafkaTemplate;

@SpringBootApplication
public class ProductApplication {

    public static void main(String[] args) {
        SpringApplication.run(ProductApplication.class, args);
    }

    @Bean
    public KafkaConfig kafkaConfig() {
        return new KafkaConfig()
                .setClusterId("e-commerce")
                .setNodeId("product-service");
    }

    @Bean
    public KafkaClient kafkaClient(KafkaConfig config, KafkaTemplate<String, String> template) {
        return new KafkaClient(config, template);
    }
}
