package com.quantaedge.bajaj.inventory;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BajajMotorcycleCatalogueControllerIntegrationTest {
  @Autowired private MockMvc mvc;

  @Test
  void anonymousCatalogueShowsAtLeastTwentyBajajModelsWithoutPrivateStockFields() throws Exception {
    mvc.perform(get("/api/v1/public/motorcycles"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()", greaterThanOrEqualTo(20)))
        .andExpect(jsonPath("$.items[*].manufacturer", everyItem(is("BAJAJ"))))
        .andExpect(jsonPath("$.items[0].exShowroomPrice").isNumber())
        .andExpect(jsonPath("$.items[0].availableCount").isNumber())
        .andExpect(jsonPath("$.items[0].purchaseCost").doesNotExist())
        .andExpect(jsonPath("$.items[0].chassisNumber").doesNotExist());
  }

  @Test
  void categoryFilterOnlyReturnsPublishedBajajModels() throws Exception {
    mvc.perform(get("/api/v1/public/motorcycles").param("family", "TOURING"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()", greaterThanOrEqualTo(2)))
        .andExpect(jsonPath("$.items[*].manufacturer", everyItem(is("BAJAJ"))));
  }

  @Test
  void unknownDealershipCannotLeakAnotherDealershipCatalogue() throws Exception {
    mvc.perform(get("/api/v1/public/motorcycles").param("dealershipCode", "NO_SUCH_DEALER"))
        .andExpect(status().isNotFound());
  }
}
