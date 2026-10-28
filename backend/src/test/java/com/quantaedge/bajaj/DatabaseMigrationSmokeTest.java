package com.quantaedge.bajaj;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
class DatabaseMigrationSmokeTest {
  @Autowired
  private JdbcTemplate jdbc;

  @Test
  void allFoundationMigrationsApplyToPostgres() {
    assertThat(tableExists("dealership")).isTrue();
    assertThat(tableExists("customer")).isTrue();
    assertThat(tableExists("vehicle_unit")).isTrue();
    assertThat(tableExists("notification_template")).isTrue();
    assertThat(tableExists("notification_campaign")).isTrue();
    assertThat(tableExists("notification_recipient")).isTrue();
    assertThat(tableExists("notification_delivery_attempt")).isTrue();
    assertThat(tableExists("outbox_event")).isTrue();
    // Integration tests may create committed synthetic fixtures for concurrency scenarios.
    // This smoke test verifies schema/migrations, not that the shared test database is empty.
  }

  private boolean tableExists(String tableName) {
    return Boolean.TRUE.equals(jdbc.queryForObject(
        "select to_regclass(?) is not null", Boolean.class, "public." + tableName));
  }
}
