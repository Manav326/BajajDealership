package com.quantaedge.bajaj.notifications;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Dispatches only database-backed, due notification campaigns; provider channels are separate. */
@Component
public class NotificationCampaignScheduler {
  private static final Logger LOGGER = LoggerFactory.getLogger(NotificationCampaignScheduler.class);
  private final NotificationManagementService notifications;

  public NotificationCampaignScheduler(NotificationManagementService notifications) {
    this.notifications = notifications;
  }

  @Scheduled(fixedDelayString = "${app.notifications.dispatch-interval-ms:15000}")
  public void dispatchDueCampaigns() {
    try {
      int count = notifications.dispatchDueScheduledCampaigns();
      if (count > 0) LOGGER.info("Dispatched {} due dealership notification campaign(s).", count);
    } catch (RuntimeException failure) {
      // Do not print message bodies, recipients, tokens, or provider credentials in logs.
      LOGGER.error("Scheduled notification dispatch did not complete ({})",
          failure.getClass().getSimpleName());
    }
  }
}
