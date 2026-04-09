package com.example.order.model;

public enum OrderStatus {
    PENDING,
    PAID,
    REJECTED;

    /**
     * Validates FSM transitions.
     * Only PENDING can transition to PAID or REJECTED.
     */
    public boolean canTransitionTo(OrderStatus target) {
        if (this == PENDING && (target == PAID || target == REJECTED)) {
            return true;
        }
        return false;
    }
}
