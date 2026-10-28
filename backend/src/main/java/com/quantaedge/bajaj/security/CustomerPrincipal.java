package com.quantaedge.bajaj.security;

public record CustomerPrincipal(
    long sessionId,
    long accountId,
    String accountPublicId,
    long customerId,
    String customerPublicId,
    long dealershipId,
    String dealershipPublicId,
    String dealershipCode,
    String dealershipName,
    String customerCode,
    String fullName,
    String preferredLanguage,
    String phone,
    String email) {}
