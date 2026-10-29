package com.quantaedge.bajaj.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quantaedge.bajaj.catalogue.BajajCatalogueService;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class BajajMotorcycleCatalogueControllerIntegrationTest {
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;

  @BeforeEach
  void seedTestDealershipAndCatalogueLinkage() {
    String code = "CAT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT);
    Long dealershipId = jdbc.queryForObject(
        "insert into dealership(code, name) values (?, ?) returning id",
        Long.class, code, "Bajaj Catalogue Test Dealership");

    // Create catalogue model masters only. No fictitious physical vehicle units are inserted.
    jdbc.update("""
        insert into vehicle_model(
          dealership_id, model_code, model_name, variant_name, colour_name, model_year, active)
        select ?, c.model_code, c.model_name, null, null, null, true
        from bajaj_catalogue_model c
        where c.active = true and c.manufacturer = 'BAJAJ'
          and not exists (
            select 1 from vehicle_model existing
            where existing.dealership_id = ? and existing.model_code = c.model_code)
        """, dealershipId, dealershipId);
    jdbc.update("""
        insert into bajaj_catalogue_dealership_model(dealership_id, model_code, is_published)
        select ?, c.model_code, true
        from bajaj_catalogue_model c
        where c.active = true and c.manufacturer = 'BAJAJ'
        on conflict (dealership_id, model_code) do update set is_published = true
        """, dealershipId);
  }

  @Test
  void anonymousCatalogueShowsAtLeastTwentyBajajModelsWithoutPrivateStockFields() throws Exception {
    mvc.perform(get("/api/v1/public/catalogue/bikes"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.manufacturer", is("BAJAJ")))
        .andExpect(jsonPath("$.bikes.length()", greaterThanOrEqualTo(20)))
        .andExpect(jsonPath("$.bikes[*].manufacturer", everyItem(is("BAJAJ"))))
        .andExpect(jsonPath("$.bikes[0].exShowroomPrice").isNumber())
        .andExpect(jsonPath("$.bikes[0].availableUnits").isNumber())
        .andExpect(jsonPath("$.bikes[0].purchaseCost").doesNotExist())
        .andExpect(jsonPath("$.bikes[0].chassisNumber").doesNotExist());
  }

  @Test
  void categoryFilterOnlyReturnsPublishedBajajModels() throws Exception {
    mvc.perform(get("/api/v1/public/catalogue/bikes").param("category", "TOURING"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.bikes.length()", greaterThanOrEqualTo(2)))
        .andExpect(jsonPath("$.bikes[*].category", everyItem(is("TOURING"))))
        .andExpect(jsonPath("$.bikes[*].manufacturer", everyItem(is("BAJAJ"))));
  }

  @Test
  void unknownCategoryIsRejected() throws Exception {
    mvc.perform(get("/api/v1/public/catalogue/bikes").param("category", "OTHER"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void unknownConfiguredDealershipCannotLeakAnotherDealershipCatalogue() {
    assertThatThrownBy(() -> new BajajCatalogueService(jdbc, "NO_SUCH_DEALER").listPublicBikes())
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }
}
