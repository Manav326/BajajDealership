package com.quantaedge.bajaj.social;
import com.fasterxml.jackson.databind.JsonNode;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
@Service
public class SocialMetaPublishingService {
 private final JdbcTemplate jdbc;private final SocialMetaService meta;private final SocialMediaAssetService assets;
 public SocialMetaPublishingService(JdbcTemplate jdbc,SocialMetaService meta,SocialMediaAssetService assets){this.jdbc=jdbc;this.meta=meta;this.assets=assets;}
 public PublishView publish(StaffPrincipal actor,PublishRequest req){
  if(!meta.isMetaConfigured())throw unavailable("Meta OAuth is not configured.");
  if(!assets.isConfigured())throw unavailable("Public artwork hosting is not configured.");
  String caption=req.caption()==null?"":req.caption().trim(),key=req.idempotencyKey()==null?"":req.idempotencyKey().trim();
  if(key.length()<8||key.length()>120)throw badRequest("A valid idempotency key is required.");
  Destination d=findDestination(actor.dealershipId(),req.destinationPublicId());SocialMediaAssetService.PreparedAsset asset=assets.prepare(actor.dealershipId(),req.assetId());
  String fingerprint=TokenDigests.sha256(d.publicId()+"\n"+asset.assetId()+"\n"+caption);UUID newId=UUID.randomUUID();
  int inserted=jdbc.update("insert into social_media_publish_job(public_id,dealership_id,destination_id,asset_id,created_by_staff_user_id,provider,destination_type,caption,idempotency_key,request_fingerprint,status,next_attempt_at) values(?,?,?,?,?,'META',?,?,?,?,'PROCESSING',now()+interval '2 minutes') on conflict(dealership_id,idempotency_key) do nothing",
    newId,actor.dealershipId(),d.id(),asset.internalId(),actor.staffUserId(),d.type(),caption,key,fingerprint);
  Job job=findByKey(actor.dealershipId(),key);if(job==null)throw new IllegalStateException("Publish job could not be recorded.");
  if(!job.fingerprint().equals(fingerprint))throw new ResponseStatusException(HttpStatus.CONFLICT,"This idempotency key was already used for different artwork or destination.");
  if(inserted==0)return view(job);
  try{
   String token=meta.decryptTokenForPublishing(d.tokenCiphertext());
   if("FACEBOOK_PAGE".equals(d.type())){
    JsonNode result=meta.graphPost(d.providerId()+"/photos",Map.of("url",asset.publicUrl(),"caption",caption,"access_token",token));
    String postId=first(result,"post_id","id");if(postId==null)throw new IllegalStateException("meta_missing_post_id");
    markPublished(job,d,actor.staffUserId(),postId);
   }else if("INSTAGRAM_PROFESSIONAL".equals(d.type())){
    JsonNode result=meta.graphPost(d.providerId()+"/media",Map.of("image_url",asset.publicUrl(),"caption",caption,"access_token",token));
    String container=text(result,"id");if(container==null)throw new IllegalStateException("meta_missing_container_id");
    jdbc.update("update social_media_publish_job set provider_container_id=?,attempt_count=0,next_attempt_at=now()+interval '4 seconds',updated_at=now() where id=? and dealership_id=? and status='PROCESSING'",container,job.id(),actor.dealershipId());
    meta.audit(actor.dealershipId(),actor.staffUserId(),d.connectionId(),d.id(),"SOCIAL_PUBLISH_PROCESSING",Map.of("publishJobPublicId",job.publicId().toString()));
   }else throw badRequest("Destination type cannot be published.");
  }catch(Exception e){
   String code=safeCode(e.getMessage()),state=isUncertain(code)?"UNKNOWN":"FAILED";
   jdbc.update("update social_media_publish_job set status=?,error_code=?,updated_at=now(),poll_lock_until=null where id=? and dealership_id=? and status='PROCESSING'",state,code,job.id(),actor.dealershipId());
   meta.audit(actor.dealershipId(),actor.staffUserId(),d.connectionId(),d.id(),"SOCIAL_PUBLISH_"+state,Map.of("publishJobPublicId",job.publicId().toString(),"errorCode",code));
  }
  return status(actor,job.publicId());
 }
 public PublishView status(StaffPrincipal actor,UUID id){
  Job job=findByPublicId(actor.dealershipId(),id);
  if("PROCESSING".equals(job.status())&&"FACEBOOK_PAGE".equals(job.destinationType())&&job.createdAt().isBefore(Instant.now().minusSeconds(180))){
   jdbc.update("update social_media_publish_job set status='UNKNOWN',error_code='facebook_outcome_unconfirmed',updated_at=now() where id=? and dealership_id=? and status='PROCESSING'",job.id(),actor.dealershipId());
   job=findByPublicId(actor.dealershipId(),id);
  }return view(job);
 }
 @Scheduled(fixedDelayString="${app.social.meta.publish-poll-interval-ms:15000}")
 public void pollDueInstagramJobs(){
  List<UUID> ids=jdbc.query("with due as (select id from social_media_publish_job where status='PROCESSING' and destination_type='INSTAGRAM_PROFESSIONAL' and provider_container_id is not null and next_attempt_at<=now() and (poll_lock_until is null or poll_lock_until<now()) order by next_attempt_at,id limit 10 for update skip locked) update social_media_publish_job j set poll_lock_until=now()+interval '90 seconds' from due where j.id=due.id returning j.public_id",(rs,n)->rs.getObject(1,UUID.class));
  for(UUID id:ids){try{pollInstagram(id);}catch(RuntimeException ignored){/* next schedule retries status reads */}}
 }
 private void pollInstagram(UUID id){
  List<InstagramJob> rows=jdbc.query("select j.id,j.public_id,j.dealership_id,j.created_by_staff_user_id,j.provider_container_id,j.attempt_count,d.id destination_id,d.connection_id,d.provider_destination_id,d.page_access_token_ciphertext from social_media_publish_job j join social_media_destination d on d.id=j.destination_id and d.dealership_id=j.dealership_id where j.public_id=? and j.status='PROCESSING' and j.destination_type='INSTAGRAM_PROFESSIONAL'",
   (rs,n)->new InstagramJob(rs.getLong("id"),rs.getObject("public_id",UUID.class),rs.getLong("dealership_id"),rs.getLong("created_by_staff_user_id"),rs.getString("provider_container_id"),rs.getInt("attempt_count"),rs.getLong("destination_id"),rs.getLong("connection_id"),rs.getString("provider_destination_id"),rs.getString("page_access_token_ciphertext")),id);
  if(rows.isEmpty())return;InstagramJob j=rows.getFirst();
  try{
   String token=meta.decryptTokenForPublishing(j.tokenCiphertext());JsonNode res=meta.graphGet(j.containerId(),Map.of("fields","status_code,status","access_token",token));String code=text(res,"status_code");
   if("FINISHED".equalsIgnoreCase(code)){
    try{JsonNode posted=meta.graphPost(j.instagramId()+"/media_publish",Map.of("creation_id",j.containerId(),"access_token",token));String post=text(posted,"id");if(post==null)finish(j,"UNKNOWN",null,"meta_missing_publish_id");else finish(j,"PUBLISHED",post,null);}
    catch(Exception e){String safe=safeCode(e.getMessage());finish(j,isUncertain(safe)?"UNKNOWN":"FAILED",null,safe);}
   }else if("ERROR".equalsIgnoreCase(code)||"EXPIRED".equalsIgnoreCase(code))finish(j,"FAILED",null,"instagram_container_"+code.toLowerCase(java.util.Locale.ROOT));
   else if(j.attempts()>=9)finish(j,"FAILED",null,"instagram_container_timeout");
   else jdbc.update("update social_media_publish_job set attempt_count=attempt_count+1,next_attempt_at=now()+interval '15 seconds',poll_lock_until=null,error_code='instagram_container_processing',updated_at=now() where id=? and dealership_id=? and status='PROCESSING'",j.id(),j.dealershipId());
  }catch(Exception e){
   String safe=safeCode(e.getMessage());if(j.attempts()>=9)finish(j,"FAILED",null,"instagram_status_timeout");
   else jdbc.update("update social_media_publish_job set attempt_count=attempt_count+1,next_attempt_at=now()+interval '20 seconds',poll_lock_until=null,error_code=?,updated_at=now() where id=? and dealership_id=? and status='PROCESSING'",safe,j.id(),j.dealershipId());
  }
 }
 private void finish(InstagramJob j,String state,String postId,String error){
  jdbc.update("update social_media_publish_job set status=?,external_post_id=?,error_code=?,published_at=?,poll_lock_until=null,updated_at=now() where id=? and dealership_id=? and status='PROCESSING'",state,postId,error,"PUBLISHED".equals(state)?Timestamp.from(Instant.now()):null,j.id(),j.dealershipId());
  meta.audit(j.dealershipId(),j.createdBy(),j.connectionId(),j.destinationId(),"SOCIAL_PUBLISH_"+state,Map.of("publishJobPublicId",j.publicId().toString(),"status",state,"postId",postId==null?"":postId,"errorCode",error==null?"":error));
 }
 private void markPublished(Job j,Destination d,long actor,String postId){
  jdbc.update("update social_media_publish_job set status='PUBLISHED',external_post_id=?,error_code=null,published_at=now(),updated_at=now() where id=? and dealership_id=? and status='PROCESSING'",postId,j.id(),d.dealershipId());
  meta.audit(d.dealershipId(),actor,d.connectionId(),d.id(),"SOCIAL_PUBLISH_PUBLISHED",Map.of("publishJobPublicId",j.publicId().toString(),"destinationType",d.type(),"externalPostId",postId));
 }
 private Destination findDestination(long did,UUID pid){
  List<Destination> rows=jdbc.query("select id,public_id,dealership_id,connection_id,destination_type,provider_destination_id,display_name,page_access_token_ciphertext from social_media_destination where dealership_id=? and public_id=? and provider='META' and status='ACTIVE'",
   (rs,n)->new Destination(rs.getLong("id"),rs.getObject("public_id",UUID.class),rs.getLong("dealership_id"),rs.getLong("connection_id"),rs.getString("destination_type"),rs.getString("provider_destination_id"),rs.getString("display_name"),rs.getString("page_access_token_ciphertext")),did,pid);
  if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Connected destination was not found.");return rows.getFirst();
 }
 private Job findByKey(long did,String key){
  List<Job> rows=jdbc.query("select j.id,j.public_id,j.dealership_id,j.destination_id,j.request_fingerprint,j.status,j.destination_type,d.display_name destination_name,j.caption,j.external_post_id,j.error_code,j.created_at,j.updated_at,j.published_at from social_media_publish_job j join social_media_destination d on d.id=j.destination_id and d.dealership_id=j.dealership_id where j.dealership_id=? and j.idempotency_key=?",(rs,n)->mapJob(rs),did,key);
  return rows.isEmpty()?null:rows.getFirst();
 }
 private Job findByPublicId(long did,UUID id){
  List<Job> rows=jdbc.query("select j.id,j.public_id,j.dealership_id,j.destination_id,j.request_fingerprint,j.status,j.destination_type,d.display_name destination_name,j.caption,j.external_post_id,j.error_code,j.created_at,j.updated_at,j.published_at from social_media_publish_job j join social_media_destination d on d.id=j.destination_id and d.dealership_id=j.dealership_id where j.dealership_id=? and j.public_id=?",(rs,n)->mapJob(rs),did,id);
  if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Publish job was not found.");return rows.getFirst();
 }
 private static Job mapJob(java.sql.ResultSet r)throws java.sql.SQLException{
  Timestamp p=r.getTimestamp("published_at");return new Job(r.getLong("id"),r.getObject("public_id",UUID.class),r.getLong("dealership_id"),r.getLong("destination_id"),r.getString("request_fingerprint"),r.getString("status"),r.getString("destination_type"),r.getString("destination_name"),r.getString("caption"),r.getString("external_post_id"),r.getString("error_code"),r.getTimestamp("created_at").toInstant(),r.getTimestamp("updated_at").toInstant(),p==null?null:p.toInstant());
 }
 private static PublishView view(Job j){return new PublishView(j.publicId(),j.status(),j.destinationType(),j.destinationName(),j.caption(),j.externalPostId(),j.errorCode(),j.createdAt(),j.updatedAt(),j.publishedAt());}
 private static String first(JsonNode n,String a,String b){String v=text(n,a);return v==null?text(n,b):v;}
 private static String text(JsonNode n,String key){String v=n.path(key).asText("").trim();return v.isEmpty()?null:v;}
 private static String safeCode(String raw){String v=raw==null?"":raw.replaceAll("[^a-zA-Z0-9_-]","");return v.isBlank()?"provider_error":v.substring(0,Math.min(120,v.length()));}
 private static boolean isUncertain(String v){String s=v.toLowerCase(java.util.Locale.ROOT);return s.contains("network")||s.contains("interrupted")||s.contains("timeout")||s.contains("missing_post_id")||s.contains("missing_publish_id")||s.contains("missing_container_id")||s.contains("http_5");}
 private static ResponseStatusException badRequest(String m){return new ResponseStatusException(HttpStatus.BAD_REQUEST,m);}
 private static ResponseStatusException unavailable(String m){return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,m);}
 public record PublishRequest(@NotNull UUID destinationPublicId,@NotNull UUID assetId,@Size(max=2200) String caption,@NotBlank @Size(max=120) String idempotencyKey){}
 public record PublishView(UUID publicId,String status,String destinationType,String destinationName,String caption,String externalPostId,String errorCode,Instant createdAt,Instant updatedAt,Instant publishedAt){}
 private record Destination(long id,UUID publicId,long dealershipId,long connectionId,String type,String providerId,String displayName,String tokenCiphertext){}
 private record Job(long id,UUID publicId,long dealershipId,long destinationId,String fingerprint,String status,String destinationType,String destinationName,String caption,String externalPostId,String errorCode,Instant createdAt,Instant updatedAt,Instant publishedAt){}
 private record InstagramJob(long id,UUID publicId,long dealershipId,long createdBy,String containerId,int attempts,long destinationId,long connectionId,String instagramId,String tokenCiphertext){}
}
