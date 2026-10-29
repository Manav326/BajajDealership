package com.quantaedge.bajaj.social;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class SocialWhatsappService {
 private static final Pattern PLACEHOLDER=Pattern.compile("\\{\\{([0-9]+)}}");
 private static final Set<String> OPT_OUT=Set.of("STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT");
 private final JdbcTemplate jdbc; private final ObjectMapper mapper; private final SocialMediaAssetService assets;
 private final boolean enabled; private final String graphVersion,phoneNumberId,businessAccountId,accessToken,verifyToken,appSecret,dealershipCode;
 private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();

 public SocialWhatsappService(JdbcTemplate jdbc,ObjectMapper mapper,SocialMediaAssetService assets,
  @Value("${app.social.whatsapp.enabled:false}") boolean enabled,
  @Value("${app.social.meta.graph-api-version:}") String graphVersion,
  @Value("${app.social.whatsapp.phone-number-id:}") String phoneNumberId,
  @Value("${app.social.whatsapp.business-account-id:}") String businessAccountId,
  @Value("${app.social.whatsapp.access-token:}") String accessToken,
  @Value("${app.social.whatsapp.verify-token:}") String verifyToken,
  @Value("${app.social.meta.app-secret:}") String appSecret,
  @Value("${app.social.whatsapp.dealership-code:}") String dealershipCode) {
  this.jdbc=jdbc;this.mapper=mapper;this.assets=assets;this.enabled=enabled;this.graphVersion=clean(graphVersion);
  this.phoneNumberId=clean(phoneNumberId);this.businessAccountId=clean(businessAccountId);this.accessToken=clean(accessToken);
  this.verifyToken=clean(verifyToken);this.appSecret=clean(appSecret);this.dealershipCode=clean(dealershipCode);
 }

 public StatusView status(StaffPrincipal actor) {
  boolean configured=configuredFor(actor.dealershipId());
  return new StatusView(configured,configured&&webhookConfigured(),
   configured?"WhatsApp Cloud API is configured. Each send still requires current customer consent and an approved template."
   :"WhatsApp Business is not configured for this dealership. Messaging is disabled.",
   configured&&webhookConfigured()?"Signed delivery-status and inbound opt-out webhooks are configured."
   :"Delivery updates require the Meta app secret, webhook token and phone-number configuration.");
 }

 public List<CustomerOption> customers(StaffPrincipal actor,String query,int requestedLimit) {
  int limit=Math.max(1,Math.min(100,requestedLimit));String term=clean(query);
  if(term.length()>80)throw badRequest("Customer search must be 80 characters or shorter.");
  String pattern="%"+term.replace("!","!!").replace("%","!%").replace("_","!_")+"%";
  return jdbc.query("""
   select c.public_id,c.customer_code,c.full_name,c.phone,w.status as consent_status,w.consent_source,w.updated_at as consent_updated_at
   from customer c left join customer_whatsapp_consent w on w.customer_id=c.id and w.dealership_id=c.dealership_id
   where c.dealership_id=? and c.status='ACTIVE'
   and (?='' or c.full_name ilike ? escape '!' or c.customer_code ilike ? escape '!')
   order by lower(c.full_name),c.id limit ?
   """,(rs,n)->{
    String phone=normalizeE164(rs.getString("phone"));java.sql.Timestamp updated=rs.getTimestamp("consent_updated_at");
    return new CustomerOption(rs.getObject("public_id",UUID.class),rs.getString("customer_code"),rs.getString("full_name"),
      maskPhone(phone),phone!=null,rs.getString("consent_status")==null?"NOT_RECORDED":rs.getString("consent_status"),
      rs.getString("consent_source"),updated==null?null:updated.toInstant());
   },actor.dealershipId(),term,pattern,pattern,limit);
 }

 public ConsentView recordConsent(StaffPrincipal actor,UUID customerPublicId,ConsentRequest request) {
  if(request==null||request.optedIn()==null)throw badRequest("Choose opt-in or opt-out.");
  String source=clean(request.source()),evidence=clean(request.evidenceReference());
  if(source.isBlank()||source.length()>100)throw badRequest("Record the source of the customer preference.");
  if(evidence.length()>500)throw badRequest("Consent evidence reference must be 500 characters or shorter.");
  Customer customer=findCustomer(actor.dealershipId(),customerPublicId);String phone=normalizeE164(customer.phone());
  if(phone==null)throw new ResponseStatusException(HttpStatus.CONFLICT,"Customer phone must be in international E.164 format before WhatsApp can be enabled.");
  boolean optedIn=request.optedIn();java.sql.Timestamp now=java.sql.Timestamp.from(Instant.now());
  jdbc.update("""
   insert into customer_whatsapp_consent(dealership_id,customer_id,phone_number_e164,status,consent_source,evidence_reference,
    captured_by_staff_user_id,consented_at,opted_out_at,updated_at)
   values(?,?,?,?,?,?,?,?,?,now())
   on conflict(dealership_id,customer_id) do update set phone_number_e164=excluded.phone_number_e164,status=excluded.status,
    consent_source=excluded.consent_source,evidence_reference=excluded.evidence_reference,captured_by_staff_user_id=excluded.captured_by_staff_user_id,
    consented_at=excluded.consented_at,opted_out_at=excluded.opted_out_at,updated_at=now()
   """,actor.dealershipId(),customer.id(),phone,optedIn?"OPTED_IN":"OPTED_OUT",source,evidence.isBlank()?null:evidence,
    actor.staffUserId(),optedIn?now:null,optedIn?null:now);
  audit(actor.dealershipId(),actor.staffUserId(),"CONSENT_"+(optedIn?"GRANTED":"WITHDRAWN"),
    Map.of("customerPublicId",customerPublicId.toString(),"source",source,"evidenceRecorded",!evidence.isBlank()));
  ConsentRow consent=findConsent(actor.dealershipId(),customer.id());
  return new ConsentView(customerPublicId,customer.name(),maskPhone(phone),consent.status(),consent.source(),consent.evidence(),
    consent.consentedAt(),consent.optedOutAt(),consent.updatedAt());
 }

 public List<TemplateView> templates(StaffPrincipal actor) {
  requireConfigured(actor.dealershipId());
  JsonNode data=graphGet(businessAccountId+"/message_templates",Map.of("fields","name,status,language,category,components","limit","100")).path("data");
  List<TemplateView> out=new ArrayList<>();if(!data.isArray())return out;
  for(JsonNode item:data) {
   String name=text(item,"name"),status=text(item,"status"),language=text(item,"language");
   if(name==null||language==null||!"APPROVED".equalsIgnoreCase(status))continue;
   TemplateShape shape=templateShape(item.path("components"));
   out.add(new TemplateView(name,language,status,text(item,"category"),shape.bodyCount(),shape.headerFormat(),shape.supported(),shape.reason()));
  }
  out.sort(java.util.Comparator.comparing(TemplateView::name).thenComparing(TemplateView::language));return out;
 }

 public MessageView send(StaffPrincipal actor,SendRequest request) {
  requireConfigured(actor.dealershipId());
  if(request==null||request.customerPublicId()==null)throw badRequest("Choose a customer.");
  String name=clean(request.templateName()),language=clean(request.languageCode()),key=clean(request.idempotencyKey());
  List<String> parameters=request.bodyParameters()==null?List.of():request.bodyParameters();
  if(name.isBlank()||name.length()>120)throw badRequest("Choose a Meta-approved template.");
  if(!language.matches("[A-Za-z]{2,3}(_[A-Za-z]{2,4})?"))throw badRequest("Choose a valid template language.");
  if(key.length()<8||key.length()>120)throw badRequest("A valid idempotency key is required.");
  if(parameters.size()>20||parameters.stream().anyMatch(p->p==null||p.length()>1024))throw badRequest("Template parameters exceed supported limits.");
  String paramsJson=writeJson(parameters),assetMarker=request.assetId()==null?"":request.assetId().toString();
  String fingerprint=TokenDigests.sha256(request.customerPublicId()+"\n"+name+"\n"+language+"\n"+paramsJson+"\n"+assetMarker);
  MessageRow prior=findByKey(actor.dealershipId(),key);
  if(prior!=null){if(!prior.fingerprint().equals(fingerprint))throw new ResponseStatusException(HttpStatus.CONFLICT,"This idempotency key belongs to a different message.");return toView(prior);}

  Customer customer=findCustomer(actor.dealershipId(),request.customerPublicId());String phone=normalizeE164(customer.phone());
  if(phone==null)throw new ResponseStatusException(HttpStatus.CONFLICT,"Customer phone must be in E.164 format.");
  ConsentRow consent=findConsentOrNull(actor.dealershipId(),customer.id());
  if(consent==null||!"OPTED_IN".equals(consent.status())||!phone.equals(consent.phone()))
    throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Current WhatsApp opt-in is missing, withdrawn, or tied to a different phone number.");

  TemplateView template=templates(actor).stream().filter(t->t.name().equals(name)&&t.language().equalsIgnoreCase(language))
    .findFirst().orElseThrow(()->new ResponseStatusException(HttpStatus.CONFLICT,"Template is not currently approved for this language."));
  if(!template.supported())throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,template.unsupportedReason());
  if(parameters.size()!=template.bodyParameterCount())throw badRequest("This template requires exactly "+template.bodyParameterCount()+" body parameter(s).");
  if(parameters.stream().anyMatch(String::isBlank))throw badRequest("Fill in every required template parameter.");
  SocialMediaAssetService.PreparedAsset asset=null;
  if("IMAGE".equals(template.headerFormat())){if(request.assetId()==null)throw badRequest("This template requires a campaign image.");asset=assets.prepare(actor.dealershipId(),request.assetId());}
  else if(request.assetId()!=null)throw badRequest("This template does not have an image header.");

  UUID publicId=UUID.randomUUID();
  int inserted=jdbc.update("""
   insert into whatsapp_message_send(public_id,dealership_id,customer_id,created_by_staff_user_id,template_name,language_code,
    template_category,body_parameters,asset_id,idempotency_key,request_fingerprint,status)
   values(?,?,?,?,?,?,?,?::jsonb,?,?,?,'PROCESSING')
   on conflict(dealership_id,idempotency_key) do nothing
   """,publicId,actor.dealershipId(),customer.id(),actor.staffUserId(),name,language,template.category(),paramsJson,
    asset==null?null:asset.internalId(),key,fingerprint);
  MessageRow job=findByKey(actor.dealershipId(),key);
  if(job==null)throw new IllegalStateException("WhatsApp send could not be recorded.");
  if(!job.fingerprint().equals(fingerprint))throw new ResponseStatusException(HttpStatus.CONFLICT,"This idempotency key belongs to a different message.");
  if(inserted==0)return toView(job);

  try {
   JsonNode response=sendTemplate(phone,template,parameters,asset==null?null:asset.publicUrl());
   String providerId=response.path("messages").path(0).path("id").asText("").trim();
   if(providerId.isBlank())updateStatus(job.publicId(),"UNKNOWN","whatsapp_missing_message_id");
   else{
    jdbc.update("update whatsapp_message_send set status='ACCEPTED',provider_message_id=?,accepted_at=now(),updated_at=now() where dealership_id=? and public_id=? and status='PROCESSING'",
      providerId,actor.dealershipId(),job.publicId());
    audit(actor.dealershipId(),actor.staffUserId(),"MESSAGE_ACCEPTED",Map.of("messagePublicId",job.publicId().toString(),"template",name));
   }
  } catch(Exception failure) {
   String code=failureCode(failure),next=isUncertain(code)?"UNKNOWN":"FAILED";
   updateStatus(job.publicId(),next,code);audit(actor.dealershipId(),actor.staffUserId(),"MESSAGE_"+next,Map.of("messagePublicId",job.publicId().toString(),"errorCode",code));
  }
  return toView(findByPublicId(actor.dealershipId(),job.publicId()));
 }

 public MessageView messageStatus(StaffPrincipal actor,UUID id){return toView(findByPublicId(actor.dealershipId(),id));}
 public MessageView messageByInternalIdForSchedule(long dealershipId,long messageId){
  List<MessageRow> rows=jdbc.query("select id,public_id,dealership_id,customer_id,request_fingerprint,status,template_name,language_code,template_category,provider_message_id,error_code,created_at,updated_at,accepted_at,sent_at,delivered_at,read_at,failed_at from whatsapp_message_send where dealership_id=? and id=?",
    (rs,n)->mapMessage(rs),dealershipId,messageId);
  if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"WhatsApp message was not found.");
  return toView(rows.getFirst());
 }
 public MessageView messageByIdempotencyKeyForSchedule(long dealershipId,String key){
  MessageRow row=findByKey(dealershipId,key);
  if(row==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"WhatsApp message was not found.");
  return toView(row);
 }
 public boolean verifyWebhook(String mode,String token,String challenge){
  return "subscribe".equals(mode)&&!verifyToken.isBlank()&&token!=null&&challenge!=null&&challenge.length()<=2000
    &&MessageDigest.isEqual(verifyToken.getBytes(StandardCharsets.UTF_8),token.getBytes(StandardCharsets.UTF_8));
 }
 public boolean verifyWebhookSignature(byte[] body,String signature){
  if(!webhookConfigured()||body==null||signature==null||!signature.startsWith("sha256="))return false;
  try{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(appSecret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
   String expected="sha256="+HexFormat.of().formatHex(mac.doFinal(body));
   return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),signature.getBytes(StandardCharsets.UTF_8));
  }catch(Exception e){return false;}
 }
 public void processVerifiedWebhook(byte[] body){
  final JsonNode root;try{root=mapper.readTree(body);}catch(IOException e){throw badRequest("Webhook payload is invalid JSON.");}
  Long dealershipId=configuredDealershipId();JsonNode entries=root.path("entry");if(!entries.isArray())return;
  for(JsonNode entry:entries){JsonNode changes=entry.path("changes");if(!changes.isArray())continue;
   for(JsonNode change:changes){JsonNode value=change.path("value");String phoneId=text(value.path("metadata"),"phone_number_id");
    if(phoneId!=null&&!phoneId.equals(phoneNumberId))continue;
    JsonNode statuses=value.path("statuses");if(statuses.isArray())for(JsonNode event:statuses)processStatus(event);
    JsonNode messages=value.path("messages");if(dealershipId!=null&&messages.isArray())for(JsonNode msg:messages)processOptOut(dealershipId,msg);
   }
  }
 }
 private void processStatus(JsonNode event){
  String providerId=text(event,"id"),raw=text(event,"status");if(providerId==null||raw==null)return;
  String incoming=raw.toUpperCase(Locale.ROOT);if(!Set.of("SENT","DELIVERED","READ","FAILED").contains(incoming))return;
  List<MessageRow> rows=jdbc.query("""
   select id,public_id,dealership_id,customer_id,request_fingerprint,status,template_name,language_code,template_category,
    provider_message_id,error_code,created_at,updated_at,accepted_at,sent_at,delivered_at,read_at,failed_at
   from whatsapp_message_send where provider_message_id=?
   """,(rs,n)->mapMessage(rs),providerId);
  if(rows.isEmpty())return;MessageRow job=rows.getFirst();String next=nextStatus(job.status(),incoming);if(next.equals(job.status()))return;
  String error=null;
  if("FAILED".equals(next)){JsonNode errors=event.path("errors");error=errors.isArray()&&!errors.isEmpty()?"whatsapp_provider_"+safeCode(errors.path(0).path("code").asText("failed")):"whatsapp_provider_failed";}
  jdbc.update("""
   update whatsapp_message_send set status=?,error_code=?,
    sent_at=case when ?='SENT' then coalesce(sent_at,now()) else sent_at end,
    delivered_at=case when ?='DELIVERED' then coalesce(delivered_at,now()) else delivered_at end,
    read_at=case when ?='READ' then coalesce(read_at,now()) else read_at end,
    failed_at=case when ?='FAILED' then coalesce(failed_at,now()) else failed_at end,updated_at=now()
   where provider_message_id=?
   """,next,error,next,next,next,next,providerId);
  audit(job.dealershipId(),null,"STATUS_"+next,Map.of("messagePublicId",job.publicId().toString(),"providerMessageIdHash",TokenDigests.sha256(providerId).substring(0,16)));
 }
 private static String nextStatus(String current,String incoming){
  if(Set.of("READ","FAILED").contains(current))return current;
  if("READ".equals(incoming))return "READ";
  if("DELIVERED".equals(current))return current;
  if("DELIVERED".equals(incoming))return "DELIVERED";
  if("SENT".equals(incoming)&&Set.of("PROCESSING","ACCEPTED","UNKNOWN").contains(current))return "SENT";
  if("FAILED".equals(incoming)&&Set.of("PROCESSING","ACCEPTED","SENT","UNKNOWN").contains(current))return "FAILED";
  return current;
 }
 private void processOptOut(long dealershipId,JsonNode msg){
  if(!"text".equalsIgnoreCase(text(msg,"type")))return;
  String sender=text(msg,"from"),body=clean(msg.path("text").path("body").asText("")).toUpperCase(Locale.ROOT).replaceAll("[^A-Z]","");
  if(sender==null||!OPT_OUT.contains(body))return;String digits=sender.replaceAll("[^0-9]","");
  if(!digits.matches("[1-9][0-9]{7,14}"))return;
  List<Customer> matches=jdbc.query("select id,public_id,full_name,phone from customer where dealership_id=? and status='ACTIVE' and regexp_replace(phone,'[^0-9]','','g')=?",
   (rs,n)->new Customer(rs.getLong("id"),rs.getObject("public_id",UUID.class),rs.getString("full_name"),rs.getString("phone")),dealershipId,digits);
  for(Customer customer:matches){String phone=normalizeE164(customer.phone());if(phone==null)continue;
   jdbc.update("""
    insert into customer_whatsapp_consent(dealership_id,customer_id,phone_number_e164,status,consent_source,evidence_reference,captured_by_staff_user_id,consented_at,opted_out_at,updated_at)
    values(?,?,?,'OPTED_OUT','WHATSAPP_INBOUND_STOP','Inbound WhatsApp opt-out keyword',null,null,now(),now())
    on conflict(dealership_id,customer_id) do update set phone_number_e164=excluded.phone_number_e164,status='OPTED_OUT',
     consent_source=excluded.consent_source,evidence_reference=excluded.evidence_reference,captured_by_staff_user_id=null,
     consented_at=null,opted_out_at=now(),updated_at=now()
    """,dealershipId,customer.id(),phone);
   audit(dealershipId,null,"CONSENT_WITHDRAWN",Map.of("customerPublicId",customer.publicId().toString(),"source","WHATSAPP_INBOUND_STOP"));
  }
 }
 private TemplateShape templateShape(JsonNode components){
  int bodyCount=0;String header="NONE";boolean supported=true;String reason=null;
  if(components.isArray())for(JsonNode c:components){String type=text(c,"type");
   if("BODY".equalsIgnoreCase(type)){CountResult count=countParameters(text(c,"text"));bodyCount=count.count();if(!count.valid()){supported=false;reason="Body placeholders must be sequential, starting at {{1}}.";}}
   else if("HEADER".equalsIgnoreCase(type)){header=text(c,"format");if(header==null)header="TEXT";
    if("TEXT".equalsIgnoreCase(header)){CountResult count=countParameters(text(c,"text"));if(count.count()>0||!count.valid()){supported=false;reason="Dynamic text headers are not supported yet.";}}
    else if(!"IMAGE".equalsIgnoreCase(header)){supported=false;reason="Only static and image headers are supported.";}
   }else if("BUTTONS".equalsIgnoreCase(type)){supported=false;reason="Template buttons require a parameter workflow not yet supported.";}
  }
  return new TemplateShape(bodyCount,header.toUpperCase(Locale.ROOT),supported,reason);
 }
 private JsonNode sendTemplate(String phone,TemplateView template,List<String> parameters,String imageUrl){
  ObjectNode body=mapper.createObjectNode();body.put("messaging_product","whatsapp");body.put("to",phone.substring(1));body.put("type","template");
  ObjectNode t=body.putObject("template");t.put("name",template.name());t.putObject("language").put("code",template.language());ArrayNode components=t.putArray("components");
  if("IMAGE".equals(template.headerFormat())){ObjectNode h=components.addObject();h.put("type","header");h.putArray("parameters").addObject().put("type","image").putObject("image").put("link",imageUrl);}
  if(!parameters.isEmpty()){ObjectNode b=components.addObject();b.put("type","body");ArrayNode p=b.putArray("parameters");for(String value:parameters)p.addObject().put("type","text").put("text",value);}
  return graphPost(phoneNumberId+"/messages",body);
 }
 private JsonNode graphGet(String resource,Map<String,String> query){
  URI uri=UriComponentsBuilder.fromUriString("https://graph.facebook.com/"+graphVersion+"/"+resource).queryParams(toQuery(query)).build().encode().toUri();
  return execute(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20)).header("Authorization","Bearer "+accessToken).header("Accept","application/json").GET().build());
 }
 private JsonNode graphPost(String resource,JsonNode payload){
  return execute(HttpRequest.newBuilder(URI.create("https://graph.facebook.com/"+graphVersion+"/"+resource)).timeout(Duration.ofSeconds(20))
    .header("Authorization","Bearer "+accessToken).header("Accept","application/json").header("Content-Type","application/json")
    .POST(HttpRequest.BodyPublishers.ofString(payload.toString(),StandardCharsets.UTF_8)).build());
 }
 private JsonNode execute(HttpRequest request){
  try{HttpResponse<String> response=http.send(request,HttpResponse.BodyHandlers.ofString());
   if(response.statusCode()<200||response.statusCode()>=300)throw new WhatsappProviderException(response.statusCode()>=500?"whatsapp_http_5xx":"whatsapp_http_"+response.statusCode());
   JsonNode payload=mapper.readTree(response.body());if(payload==null)throw new WhatsappProviderException("whatsapp_empty_response");
   if(payload.has("error"))throw new WhatsappProviderException("whatsapp_api_"+safeCode(payload.path("error").path("code").asText("provider_error")));
   return payload;
  }catch(JsonProcessingException e){throw new WhatsappProviderException("whatsapp_invalid_json");}
   catch(IOException e){throw new WhatsappProviderException("whatsapp_network_error");}
   catch(InterruptedException e){Thread.currentThread().interrupt();throw new WhatsappProviderException("whatsapp_request_interrupted");}
 }
 private boolean configuredFor(long dealershipId){
  if(!enabled||!graphVersion.matches("v[0-9]+\\.[0-9]+")||phoneNumberId.isBlank()||businessAccountId.isBlank()||accessToken.isBlank()||dealershipCode.isBlank())return false;
  List<String> codes=jdbc.query("select code from dealership where id=? and status='ACTIVE'",(rs,n)->rs.getString(1),dealershipId);
  return codes.size()==1&&dealershipCode.equals(codes.getFirst());
 }
 private boolean webhookConfigured(){return enabled&&!phoneNumberId.isBlank()&&!verifyToken.isBlank()&&!appSecret.isBlank();}
 private Long configuredDealershipId(){
  if(!enabled||dealershipCode.isBlank())return null;
  List<Long> ids=jdbc.query("select id from dealership where code=? and status='ACTIVE'",(rs,n)->rs.getLong(1),dealershipCode);
  return ids.size()==1?ids.getFirst():null;
 }
 private void requireConfigured(long id){if(!configuredFor(id))throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"WhatsApp Cloud API is not configured for this dealership.");}
 private Customer findCustomer(long dealershipId,UUID publicId){
  List<Customer> rows=jdbc.query("select id,public_id,full_name,phone from customer where dealership_id=? and public_id=? and status='ACTIVE'",
   (rs,n)->new Customer(rs.getLong("id"),rs.getObject("public_id",UUID.class),rs.getString("full_name"),rs.getString("phone")),dealershipId,publicId);
  if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Customer was not found.");return rows.getFirst();
 }
 private ConsentRow findConsentOrNull(long did,long customerId){
  List<ConsentRow> rows=jdbc.query("select phone_number_e164,status,consent_source,evidence_reference,consented_at,opted_out_at,updated_at from customer_whatsapp_consent where dealership_id=? and customer_id=?",
   (rs,n)->new ConsentRow(rs.getString("phone_number_e164"),rs.getString("status"),rs.getString("consent_source"),rs.getString("evidence_reference"),instant(rs.getTimestamp("consented_at")),instant(rs.getTimestamp("opted_out_at")),instant(rs.getTimestamp("updated_at"))),did,customerId);
  return rows.isEmpty()?null:rows.getFirst();
 }
 private ConsentRow findConsent(long did,long customerId){ConsentRow c=findConsentOrNull(did,customerId);if(c==null)throw new IllegalStateException("Consent record was not saved.");return c;}
 private MessageRow findByKey(long did,String key){
  List<MessageRow> rows=jdbc.query("select id,public_id,dealership_id,customer_id,request_fingerprint,status,template_name,language_code,template_category,provider_message_id,error_code,created_at,updated_at,accepted_at,sent_at,delivered_at,read_at,failed_at from whatsapp_message_send where dealership_id=? and idempotency_key=?",
    (rs,n)->mapMessage(rs),did,key);return rows.isEmpty()?null:rows.getFirst();
 }
 private MessageRow findByPublicId(long did,UUID id){
  List<MessageRow> rows=jdbc.query("select id,public_id,dealership_id,customer_id,request_fingerprint,status,template_name,language_code,template_category,provider_message_id,error_code,created_at,updated_at,accepted_at,sent_at,delivered_at,read_at,failed_at from whatsapp_message_send where dealership_id=? and public_id=?",
    (rs,n)->mapMessage(rs),did,id);if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"WhatsApp message was not found.");return rows.getFirst();
 }
 private MessageRow mapMessage(java.sql.ResultSet r)throws java.sql.SQLException{
  java.sql.Timestamp accepted=r.getTimestamp("accepted_at"),sent=r.getTimestamp("sent_at"),delivered=r.getTimestamp("delivered_at"),read=r.getTimestamp("read_at"),failed=r.getTimestamp("failed_at");
  return new MessageRow(r.getLong("id"),r.getObject("public_id",UUID.class),r.getLong("dealership_id"),r.getLong("customer_id"),r.getString("request_fingerprint"),r.getString("status"),
   r.getString("template_name"),r.getString("language_code"),r.getString("template_category"),r.getString("provider_message_id"),r.getString("error_code"),
   instant(r.getTimestamp("created_at")),instant(r.getTimestamp("updated_at")),instant(accepted),instant(sent),instant(delivered),instant(read),instant(failed));
 }
 private MessageView toView(MessageRow m){return new MessageView(m.publicId(),m.status(),m.templateName(),m.languageCode(),m.providerMessageId(),m.errorCode(),m.createdAt(),m.updatedAt(),m.acceptedAt(),m.sentAt(),m.deliveredAt(),m.readAt(),m.failedAt());}
 private void updateStatus(UUID id,String status,String error){jdbc.update("update whatsapp_message_send set status=?,error_code=?,failed_at=case when ?='FAILED' then now() else failed_at end,updated_at=now() where public_id=? and status='PROCESSING'",status,error,status,id);}
 private void audit(long did,Long actor,String action,Map<String,Object> details){
  try{jdbc.update("insert into whatsapp_audit_event(dealership_id,actor_staff_user_id,action,details) values(?,?,?,?::jsonb)",did,actor,action,mapper.writeValueAsString(details));}
  catch(JsonProcessingException e){throw new IllegalStateException("WhatsApp audit could not be recorded.");}
 }
 private static org.springframework.util.LinkedMultiValueMap<String,String> toQuery(Map<String,String> query){org.springframework.util.LinkedMultiValueMap<String,String> v=new org.springframework.util.LinkedMultiValueMap<>();query.forEach(v::add);return v;}
 private String writeJson(Object value){try{return mapper.writeValueAsString(value);}catch(JsonProcessingException e){throw new IllegalArgumentException("WhatsApp request could not be serialized.");}}
 private static CountResult countParameters(String value){
  if(value==null||value.isBlank())return new CountResult(0,true);Matcher m=PLACEHOLDER.matcher(value);TreeSet<Integer> n=new TreeSet<>();
  while(m.find()){try{n.add(Integer.parseInt(m.group(1)));}catch(NumberFormatException e){return new CountResult(0,false);}}
  if(n.isEmpty())return new CountResult(0,true);int max=n.last();if(max>20||n.size()!=max||n.first()!=1)return new CountResult(0,false);
  for(int i=1;i<=max;i++)if(!n.contains(i))return new CountResult(0,false);return new CountResult(max,true);
 }
 private static String normalizeE164(String raw){if(raw==null)return null;String v=raw.replaceAll("[\\s() .-]","");return v.matches("\\+[1-9][0-9]{7,14}")?v:null;}
 private static String maskPhone(String phone){return phone==null||phone.length()<5?"Invalid phone":"•••••"+phone.substring(phone.length()-4);}
 private static String text(JsonNode n,String key){String v=n.path(key).asText("").trim();return v.isEmpty()?null:v;}
 private static String clean(String v){return v==null?"":v.trim();}
 private static Instant instant(java.sql.Timestamp t){return t==null?null:t.toInstant();}
 private static String failureCode(Exception e){return e instanceof WhatsappProviderException p?p.code:safeCode(e.getMessage());}
 private static String safeCode(String raw){String v=raw==null?"":raw.replaceAll("[^a-zA-Z0-9_-]","");return v.isBlank()?"whatsapp_provider_error":v.substring(0,Math.min(100,v.length()));}
 private static boolean isUncertain(String code){String v=code.toLowerCase(Locale.ROOT);return v.contains("network")||v.contains("interrupted")||v.contains("timeout")||v.contains("http_5")||v.contains("missing_message_id");}
 private static ResponseStatusException badRequest(String m){return new ResponseStatusException(HttpStatus.BAD_REQUEST,m);}
 private record Customer(long id,UUID publicId,String name,String phone){}
 private record ConsentRow(String phone,String status,String source,String evidence,Instant consentedAt,Instant optedOutAt,Instant updatedAt){}
 private record TemplateShape(int bodyCount,String headerFormat,boolean supported,String reason){}
 private record CountResult(int count,boolean valid){}
 private record MessageRow(long id,UUID publicId,long dealershipId,long customerId,String fingerprint,String status,String templateName,String languageCode,String category,String providerMessageId,String errorCode,Instant createdAt,Instant updatedAt,Instant acceptedAt,Instant sentAt,Instant deliveredAt,Instant readAt,Instant failedAt){}
 private static final class WhatsappProviderException extends RuntimeException{final String code;WhatsappProviderException(String code){super(code);this.code=code;}}
 public record StatusView(boolean configured,boolean webhookConfigured,String message,String webhookMessage){}
 public record CustomerOption(UUID publicId,String customerCode,String fullName,String maskedPhone,boolean validPhone,String consentStatus,String consentSource,Instant consentUpdatedAt){}
 public record ConsentRequest(@jakarta.validation.constraints.NotNull Boolean optedIn,@jakarta.validation.constraints.NotBlank String source,String evidenceReference){}
 public record ConsentView(UUID customerPublicId,String customerName,String maskedPhone,String status,String source,String evidenceReference,Instant consentedAt,Instant optedOutAt,Instant updatedAt){}
 public record TemplateView(String name,String language,String status,String category,int bodyParameterCount,String headerFormat,boolean supported,String unsupportedReason){}
 public record SendRequest(UUID customerPublicId,String templateName,String languageCode,List<String> bodyParameters,UUID assetId,String idempotencyKey){}
 public record MessageView(UUID publicId,String status,String templateName,String languageCode,String providerMessageId,String errorCode,Instant createdAt,Instant updatedAt,Instant acceptedAt,Instant sentAt,Instant deliveredAt,Instant readAt,Instant failedAt){}
}
