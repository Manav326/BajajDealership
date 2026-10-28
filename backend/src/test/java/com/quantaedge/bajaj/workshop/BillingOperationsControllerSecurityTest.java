package com.quantaedge.bajaj.workshop;

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

/**
 * Guards the HTTP authorization boundary for workshop invoices, payments,
 * reversals, and handover. Business-state rules are tested by workshop integration tests.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BillingOperationsControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void invoiceAndPaymentReadsRequireAuthenticatedStaff() throws Exception {
    UUID invoiceId = UUID.randomUUID();

    mvc.perform(get("/api/v1/admin/workshop/invoices/{publicId}", invoiceId))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/admin/workshop/invoices/{publicId}/payments", invoiceId))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void customerPortalAuthorityDoesNotGrantWorkshopFinanceReadAccess() throws Exception {
    mvc.perform(get("/api/v1/admin/workshop/invoices/{publicId}", UUID.randomUUID())
            .with(user("customer-account")
                .authorities(new SimpleGrantedAuthority("customer.portal"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void financeReadDoesNotGrantInvoiceIssuePermission() throws Exception {
    mvc.perform(post("/api/v1/admin/workshop/invoices/{publicId}/issue", UUID.randomUUID())
            .with(user("finance-reader")
                .authorities(new SimpleGrantedAuthority("finance.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void financePaymentDoesNotGrantPaymentReversalPermission() throws Exception {
    mvc.perform(post("/api/v1/admin/workshop/payments/{publicId}/reverse", UUID.randomUUID())
            .with(user("cashier")
                .authorities(new SimpleGrantedAuthority("finance.payment")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "reason":"Authorization boundary test",
                  "externalReference":null
                }
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void financeInvoiceDoesNotGrantWorkshopHandoverPermission() throws Exception {
    mvc.perform(post("/api/v1/admin/workshop/job-cards/{publicId}/deliver", UUID.randomUUID())
            .with(user("invoice-issuer")
                .authorities(new SimpleGrantedAuthority("finance.invoice")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "deliveredToName":"Test customer",
                  "customerAcknowledged":true,
                  "acknowledgementMethod":"IN_PERSON",
                  "acknowledgementReference":null,
                  "note":"Authorization boundary test"
                }
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void workshopReadDoesNotGrantPaymentRecording() throws Exception {
    mvc.perform(post("/api/v1/admin/workshop/invoices/{publicId}/payments", UUID.randomUUID())
            .with(user("workshop-reader")
                .authorities(new SimpleGrantedAuthority("workshop.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "idempotencyKey":"security-test-payment",
                  "paymentMethod":"CASH",
                  "amount":1.00,
                  "paymentReference":null,
                  "note":"Authorization boundary test"
                }
                """))
        .andExpect(status().isForbidden());
  }


  @Test
  void financeReadDoesNotGrantWorkshopInvoiceCreationOrPaymentRecording() throws Exception {
    mvc.perform(post("/api/v1/admin/workshop/job-cards/{publicId}/invoices", UUID.randomUUID())
            .with(user("finance-reader")
                .authorities(new SimpleGrantedAuthority("finance.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"customerMessage":"Authorization boundary test"}
                """))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/workshop/invoices/{publicId}/payments", UUID.randomUUID())
            .with(user("finance-reader")
                .authorities(new SimpleGrantedAuthority("finance.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "idempotencyKey":"security-test-finance-read-only",
                  "paymentMethod":"CASH",
                  "amount":1.00,
                  "paymentReference":null,
                  "note":"Authorization boundary test"
                }
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void workshopReadDoesNotGrantInvoiceIssueOrHandover() throws Exception {
    mvc.perform(post("/api/v1/admin/workshop/invoices/{publicId}/issue", UUID.randomUUID())
            .with(user("workshop-reader")
                .authorities(new SimpleGrantedAuthority("workshop.read"))))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/workshop/job-cards/{publicId}/deliver", UUID.randomUUID())
            .with(user("workshop-reader")
                .authorities(new SimpleGrantedAuthority("workshop.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "deliveredToName":"Test customer",
                  "customerAcknowledged":true,
                  "acknowledgementMethod":"IN_PERSON",
                  "acknowledgementReference":null,
                  "note":"Authorization boundary test"
                }
                """))
        .andExpect(status().isForbidden());
  }

}
