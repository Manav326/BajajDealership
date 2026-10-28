package com.quantaedge.bajaj.sales;

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
 * Guards the HTTP permission boundary for high-impact sale billing operations.
 * Service-level business rules are covered by SalesTransactionServiceIntegrationTest.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SalesTransactionControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void invoiceAndPaymentReadsRequireAuthenticatedStaff() throws Exception {
    UUID invoiceId = UUID.randomUUID();

    mvc.perform(get("/api/v1/admin/sales/invoices/{publicId}", invoiceId))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/admin/sales/invoices/{publicId}/payments", invoiceId))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void invoiceIssueRequiresTheExplicitFinanceInvoicePermission() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/invoices/{publicId}/issue", UUID.randomUUID())
            .with(user("finance-reader")
                .authorities(new SimpleGrantedAuthority("finance.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void salesReadDoesNotGrantPaymentRecordingOrInvoiceCancellation() throws Exception {
    UUID invoiceId = UUID.randomUUID();

    mvc.perform(post("/api/v1/admin/sales/invoices/{publicId}/payments", invoiceId)
            .with(user("sales-reader")
                .authorities(new SimpleGrantedAuthority("sales.read")))
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

    mvc.perform(post("/api/v1/admin/sales/invoices/{publicId}/cancel", invoiceId)
            .with(user("sales-reader")
                .authorities(new SimpleGrantedAuthority("sales.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"reason\":\"Authorization boundary test\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void customerPortalAuthorityDoesNotGrantFinancialReadAccess() throws Exception {
    mvc.perform(get("/api/v1/admin/sales/invoices/{publicId}/payments", UUID.randomUUID())
            .with(user("customer-account")
                .authorities(new SimpleGrantedAuthority("customer.portal"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void financePaymentPermissionDoesNotGrantVehicleDelivery() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/bookings/{publicId}/deliver", UUID.randomUUID())
            .with(user("cashier")
                .authorities(new SimpleGrantedAuthority("finance.payment")))
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
  void reversalPermissionDoesNotGrantPaymentRecording() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/invoices/{publicId}/payments", UUID.randomUUID())
            .with(user("reversal-only")
                .authorities(new SimpleGrantedAuthority("finance.payment.reverse")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "idempotencyKey":"security-test-payment-reversal-only",
                  "paymentMethod":"CASH",
                  "amount":1.00,
                  "paymentReference":null,
                  "note":"Authorization boundary test"
                }
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void financePaymentPermissionDoesNotGrantSalesPaymentReversal() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/payments/{publicId}/reverse", UUID.randomUUID())
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
  void salesDeliveryPermissionDoesNotGrantPaymentReversal() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/payments/{publicId}/reverse", UUID.randomUUID())
            .with(user("delivery-staff")
                .authorities(new SimpleGrantedAuthority("sales.deliver")))
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
  void salesReadDoesNotGrantInvoiceCreationForBooking() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/bookings/{publicId}/invoice", UUID.randomUUID())
            .with(user("sales-reader")
                .authorities(new SimpleGrantedAuthority("sales.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "idempotencyKey":"security-test-invoice-create",
                  "vehiclePrice":10000.00,
                  "vehicleDiscount":0.00,
                  "customerMessage":"Authorization boundary test",
                  "addOns":[]
                }
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void salesManageDoesNotGrantFinancialInvoiceIssueOrCancellation() throws Exception {
    UUID invoiceId = UUID.randomUUID();

    mvc.perform(post("/api/v1/admin/sales/invoices/{publicId}/issue", invoiceId)
            .with(user("sales-manager")
                .authorities(new SimpleGrantedAuthority("sales.manage"))))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/sales/invoices/{publicId}/cancel", invoiceId)
            .with(user("sales-manager")
                .authorities(new SimpleGrantedAuthority("sales.manage")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"reason":"Authorization boundary test"}
                """))
        .andExpect(status().isForbidden());
  }

}
