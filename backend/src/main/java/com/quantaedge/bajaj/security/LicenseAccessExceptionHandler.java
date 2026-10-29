package com.quantaedge.bajaj.security;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class LicenseAccessExceptionHandler {
  @ExceptionHandler(LicenseAccessException.class)
  public ResponseEntity<LicenseError> handleLicenseAccess(LicenseAccessException exception) {
    return ResponseEntity.status(exception.status())
        .body(new LicenseError("license_restricted", exception.code(), exception.getMessage()));
  }

  public record LicenseError(String error, String code, String message) {}
}
