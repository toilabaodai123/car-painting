package com.example.demo;

import com.common.kafka.KafkaClient;
import com.common.kafka.KafkaConfig;
import com.common.message.Message;
import com.common.utils.JsonUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;

@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }

    @Bean
    public KafkaConfig kafkaConfig() {
        return new KafkaConfig()
                .setClusterId("e-commerce")
                .setNodeId("service-a");
    }

    @Bean
    public KafkaClient kafkaClient(KafkaConfig config, KafkaTemplate<String, String> template) {
        return new KafkaClient(config, template);
    }

    @Autowired
    private KafkaClient kafkaClientObj;

    @KafkaListener(topics = "e-commerce.response.service-a", groupId = "service-a-group")
    public void listenResponse(String payload) {
        try {
            Message msg = JsonUtils.getMapper().readValue(payload, Message.class);
            kafkaClientObj.handleResponse(msg);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
