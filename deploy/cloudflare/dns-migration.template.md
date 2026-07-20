# Cloudflare DNS Migration -- bookkeeping.easyfire.fyi

## Pre-migration State

Before migration, `easyfire.fyi` is authoritative at the registrar nameservers
`dns1.registrar-servers.com` and `dns2.registrar-servers.com`.
`bookkeeping.easyfire.fyi` currently has no record.
Application records served through the registrar include:

- `easyfire.fyi` A `76.76.21.21`
- `www.easyfire.fyi` CNAME `cname.vercel-dns.com`
  These must be recreated in Cloudflare after migration and preserved during rollback.

## Gated Steps (do NOT execute during this workspace phase)

### 1. Audit Existing DNS (Registrar)

```sh
nslookup bookkeeping.easyfire.fyi
nslookup -type=NS easyfire.fyi
nslookup -type=CNAME www.easyfire.fyi
```

Record all existing A, AAAA, CNAME, MX, TXT, and NS records for `easyfire.fyi`.

### 2. Export Current DNS Records

Export the current DNS zone for `easyfire.fyi` from the registrar control panel.
Save as `registrar-dns-export-YYYYMMDD.json`.

### 3. Add Domain to Cloudflare

In Cloudflare dashboard: Websites > Add a domain > `easyfire.fyi`.
Select Free plan. Cloudflare will scan existing DNS records.

### 4. Re-create All Non-Bookkeeping Records

In Cloudflare DNS tab, manually recreate every registrar DNS record that is NOT
`bookkeeping.easyfire.fyi`. Pay special attention to:

- Root domain (`easyfire.fyi`) A `76.76.21.21`
- `www.easyfire.fyi` CNAME `cname.vercel-dns.com`
- Any other subdomain records currently in the registrar zone
- MX records for email (do NOT disrupt email routing)
- TXT records (SPF, DKIM, DMARC, site verification)
- Any `_acme-challenge` or similar verification records

### 5. Create bookkeeping.easyfire.fyi CNAME

```
Type:   CNAME
Name:   bookkeeping
Target: PLACEHOLDER_TUNNEL_UUID.cfargotunnel.com
Proxy:  Proxied (orange cloud)
TTL:    Auto
```

### 6. Verify All Other Records Before Nameserver Switch

Check every record in Cloudflare matches the exported registrar records.
The goal: ONLY `bookkeeping` should change; everything else stays identical.

### 7. Switch Nameservers at Registrar

Update the domain registrar for `easyfire.fyi` to use Cloudflare's nameservers
(provided in Cloudflare dashboard after domain addition). Wait for propagation (up to 48h,
typically < 1h).

### 8. Post-migration Verification

```sh
nslookup bookkeeping.easyfire.fyi
nslookup easyfire.fyi
nslookup www.easyfire.fyi
```

Confirm:

- `bookkeeping.easyfire.fyi` resolves to Cloudflare Tunnel IPs (CNAME proxied)
- All other records resolve to the same IPs as before migration
- Email MX records are intact
- Existing applications continue to resolve correctly via Cloudflare

## Rollback Plan

If anything breaks, switch nameservers back to `dns1.registrar-servers.com`
and `dns2.registrar-servers.com` at the domain registrar.
Propagation will restore the previous state within the TTL window.
Cloudflare Access and Tunnel can remain configured but inactive.

## Single-User Access Constraint

After DNS is cut over, Cloudflare Access must be configured with a policy
restricting access to ONE email address. See `access-application.template.json`.
