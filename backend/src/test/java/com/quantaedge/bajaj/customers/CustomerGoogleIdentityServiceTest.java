package com.quantaedge.bajaj.customers;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class CustomerGoogleIdentityServiceTest {

  @Test
  void returnsOnlyTheAndroidClientIdRegisteredForTheRequestingEdition() {
    CustomerGoogleIdentityService identities = new CustomerGoogleIdentityService(
        "web-client.apps.googleusercontent.com",
        "standard-android-client.apps.googleusercontent.com",
        "liquid-glass-android-client.apps.googleusercontent.com");

    assertEquals("standard-android-client.apps.googleusercontent.com",
        identities.publicAndroidClientId("com.quantaedge.luckybajaj"));
    assertEquals("liquid-glass-android-client.apps.googleusercontent.com",
        identities.publicAndroidClientId("com.quantaedge.luckybajajlg"));
    assertEquals("standard-android-client.apps.googleusercontent.com",
        identities.publicAndroidClientId(null));
  }

  @Test
  void leavesAnUnconfiguredLiquidGlassClientExplicitlyUnavailable() {
    CustomerGoogleIdentityService identities = new CustomerGoogleIdentityService(
        "web-client.apps.googleusercontent.com",
        "standard-android-client.apps.googleusercontent.com",
        "");

    assertEquals("", identities.publicAndroidClientId("com.quantaedge.luckybajajlg"));
    assertEquals("standard-android-client.apps.googleusercontent.com",
        identities.publicAndroidClientId("com.quantaedge.luckybajaj"));
  }
}
