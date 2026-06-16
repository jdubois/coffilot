package com.example.helloworld;

public class App {

    public String greeting() {
        return "Hello, World!";
    }

    public static void main(String[] args) {
        System.out.println(new App().greeting());
    }
}
