package com.example.order;

import com.common.kafka.KafkaClient;
import com.common.kafka.KafkaConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.core.KafkaTemplate;

@SpringBootApplication
public class OrderApplication {

    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }

    @Bean
    public KafkaConfig kafkaConfig() {
        return new KafkaConfig()
                .setClusterId("e-commerce")
                .setNodeId("order-service");
    }

    @Bean
    public KafkaClient kafkaClient(KafkaConfig config, KafkaTemplate<String, String> template) {
        return new KafkaClient(config, template);
    }
}
