package com.quantaedge.bajaj.security;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Commits login throttling evidence independently so failed authentication rolls cannot erase it. */
@Service
public class CustomerPortalAttemptRecorder {
  private final JdbcTemplate jdbc;

  public CustomerPortalAttemptRecorder(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void record(String loginKeyHash, String remoteAddressHash, boolean succeeded, Long accountId) {
    jdbc.update("""
        insert into auth_login_attempt(login_key_hash, remote_address_hash, succeeded)
        values (?, ?, ?)
        """, loginKeyHash, remoteAddressHash, succeeded);

    if (accountId == null) return;
    if (succeeded) {
      jdbc.update("""
          update customer_portal_account
          set failed_login_count = 0, locked_until = null, updated_at = now()
          where id = ?
          """, accountId);
    } else {
      jdbc.update("""
          update customer_portal_account
          set locked_until = case
                when failed_login_count + 1 >= 8 then now() + interval '15 minutes'
                else locked_until
              end,
              failed_login_count = case
                when failed_login_count + 1 >= 8 then 0
                else failed_login_count + 1
              end,
              updated_at = now()
          where id = ? and status = 'ACTIVE'
          """, accountId);
    }
  }
}
