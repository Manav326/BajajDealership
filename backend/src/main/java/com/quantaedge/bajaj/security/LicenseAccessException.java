package com.quantaedge.bajaj.security;

import org.springframework.http.HttpStatus;

public class LicenseAccessException extends RuntimeException {
  private final HttpStatus status;
  private final String code;

  public LicenseAccessException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public HttpStatus status() { return status; }
  public String code() { return code; }
}
