package com.quantaedge.bajaj.security;

import java.util.Set;

public record StaffPrincipal(
    long sessionId,
    long staffUserId,
    String staffPublicId,
    long dealershipId,
    String dealershipPublicId,
    String dealershipCode,
    String fullName,
    Set<String> roles,
    Set<String> permissions) {}
