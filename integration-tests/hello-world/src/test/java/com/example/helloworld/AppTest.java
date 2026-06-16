package com.example.helloworld;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class AppTest {

    @Test
    void greetingReturnsHelloWorld() {
        assertEquals("Hello, World!", new App().greeting());
    }
}
