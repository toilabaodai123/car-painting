package com.example.demo;

import com.common.kafka.KafkaClient;
import com.common.kafka.KafkaConfig;
import com.common.kafka.RequestHandler;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.HashMap;
import java.util.Map;

@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }

    @Bean
    public KafkaConfig kafkaConfig() {
        return new KafkaConfig()
                .setClusterId("e-commerce")
                .setNodeId("service-b");
    }

    @Bean
    public KafkaClient kafkaClient(KafkaConfig config, KafkaTemplate<String, String> template) {
        return new KafkaClient(config, template);
    }

    @Bean
    public RequestHandler requestHandler(KafkaConfig config, KafkaClient client) {
        RequestHandler handler = new RequestHandler(config, client);
        handler.handle("/call-b", msg -> {
            Map<String, String> info = new HashMap<>();
            info.put("message", "Hello from Service B over Kafka!");
            info.put("projectName", "service-b");
            return info;
        });
        return handler;
    }

    @Autowired
    private RequestHandler requestHandlerObj;

    @KafkaListener(topics = "service-b-topic", groupId = "service-b-group")
    public void listen(String payload) {
        requestHandlerObj.dispatch(payload);
    }
}
