package com.quantaedge.bajaj.inventory;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SparePartsControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void sparePartEndpointsRequireAuthenticatedStaff() throws Exception {
    mvc.perform(get("/api/v1/admin/parts"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void workshopReadDoesNotGrantSparePartsAccess() throws Exception {
    mvc.perform(get("/api/v1/admin/parts")
            .with(user("workshop-reader")
                .authorities(new SimpleGrantedAuthority("workshop.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void partsReadDoesNotGrantCatalogueMutationPermission() throws Exception {
    mvc.perform(post("/api/v1/admin/parts")
            .with(user("parts-reader")
                .authorities(new SimpleGrantedAuthority("parts.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"skuCode":"FILTER-01","partName":"Oil filter","description":"Test part","unitOfMeasure":"EACH"}
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void partsReadDoesNotGrantReorderPolicyMutationPermission() throws Exception {
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(
                "/api/v1/admin/parts/{publicId}/reorder-policy", UUID.randomUUID())
            .with(user("parts-reader")
                .authorities(new SimpleGrantedAuthority("parts.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"lowStockThreshold":5.000,"reorderToQuantity":12.000}
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void partsReadDoesNotGrantStockReceiptPermission() throws Exception {
    mvc.perform(post("/api/v1/admin/part-receipts")
            .with(user("parts-reader")
                .authorities(new SimpleGrantedAuthority("parts.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "supplierPublicId":"%s",
                  "supplierReference":"PO-1",
                  "idempotencyKey":"receipt-security-test",
                  "notes":"Permission test",
                  "lines":[{"partPublicId":"%s","quantity":1,"unitCost":1.00}]
                }
                """.formatted(UUID.randomUUID(), UUID.randomUUID())))
        .andExpect(status().isForbidden());
  }

  @Test
  void partsReadDoesNotGrantReservationOrIssuePermission() throws Exception {
    mvc.perform(post("/api/v1/admin/job-cards/{jobCardPublicId}/part-reservations", UUID.randomUUID())
            .with(user("parts-reader")
                .authorities(new SimpleGrantedAuthority("parts.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "partPublicId":"%s",
                  "quantity":1,
                  "idempotencyKey":"reserve-security-test",
                  "notes":"Permission test"
                }
                """.formatted(UUID.randomUUID())))
        .andExpect(status().isForbidden());
  }
}
