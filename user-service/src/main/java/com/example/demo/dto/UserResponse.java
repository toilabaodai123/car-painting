package com.example.demo.dto;

public record UserResponse(Long id, String name, String email) {

    public static UserResponse from(com.example.demo.User user) {
        return new UserResponse(user.getId(), user.getName(), user.getEmail());
    }
}
