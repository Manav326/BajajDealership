package com.quantaedge.bajaj;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class BajajDealershipApplication {
  public static void main(String[] args) {
    SpringApplication.run(BajajDealershipApplication.class, args);
  }
}
