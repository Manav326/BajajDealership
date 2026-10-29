package com.quantaedge.bajaj.commerce;

import com.quantaedge.bajaj.security.CustomerPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/customer/parts")
@PreAuthorize("hasAuthority('customer.portal')")
public class CustomerRetailPartsController {
  private final RetailPartsService retail;

  public CustomerRetailPartsController(RetailPartsService retail) {
    this.retail = retail;
  }

  @GetMapping
  public List<RetailPartsService.RetailPartView> catalogue(
      @AuthenticationPrincipal CustomerPrincipal principal) {
    return retail.listCustomerCatalogue(principal);
  }

  @GetMapping("/orders")
  public List<RetailPartsService.RetailOrderView> orders(
      @AuthenticationPrincipal CustomerPrincipal principal) {
    return retail.listOrdersForCustomer(principal);
  }

  @PostMapping("/orders")
  public RetailPartsService.RetailOrderView placeOrder(
      @AuthenticationPrincipal CustomerPrincipal principal,
      @Valid @RequestBody PlaceOrderRequest request) {
    return retail.placeOrder(principal, new RetailPartsService.PlaceOrderRequest(
        request.lines().stream().map(line ->
            new RetailPartsService.OrderLineRequest(line.partPublicId(), line.quantity())).toList(),
        request.fitmentModelCode(), request.customerNote(), request.idempotencyKey()));
  }

  @PostMapping("/orders/{publicId}/cancel")
  public RetailPartsService.RetailOrderView cancel(
      @AuthenticationPrincipal CustomerPrincipal principal, @PathVariable UUID publicId) {
    return retail.cancelOrder(principal, publicId);
  }

  public record LineRequest(
      @NotNull UUID partPublicId,
      @NotNull @DecimalMin(value = "0.001") @Digits(integer = 9, fraction = 3) BigDecimal quantity) {}

  public record PlaceOrderRequest(
      @NotEmpty @Size(max = 50) List<@Valid LineRequest> lines,
      @Size(max = 60) String fitmentModelCode,
      @Size(max = 1000) String customerNote,
      @NotBlank @Size(max = 120) String idempotencyKey) {}
}
