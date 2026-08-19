# Axus admin — user & org management

Everything below runs from **your laptop** in Git Bash, and needs the `hub` and
`insights` SSH aliases (already set up). You can also just ask Claude to run any
of these for you in plain English.

Access lives at the **Hub (Authentik)**. AIN and other products only reflect it.

---

## Add a user
Creates the invitation with the right groups **and** emails a branded set-up
link. Their access attaches automatically within ~1 minute of enrollment.

```bash
add-user.sh <email> "<Full Name>" <observer|regular|admin|sysadmin> <org-slug>
```
```bash
add-user.sh jsmith@bcomhealth.org "John Smith" observer bcom
```
- If the email can't be delivered, it won't fail — it prints the link to share manually.
- Refuses if that email already has an Axus account (adjust their groups instead).

## Remove a user
**Fully deletes** the account from the Hub *and* from Insights, plus any pending
invitation. Irreversible.

```bash
remove-user.sh <email>
```
```bash
remove-user.sh jsmith@bcomhealth.org
```
- `admin@axustechnologies.com` is protected and cannot be removed.

## Add a new client organization
Orgs are created in the **AIN admin UI** (AIN needs the Meraki org id). After
that, run this once to wire up the Hub group + SSO mapping so you can invite
people into it:

```bash
link-org.sh <slug> "<Organization name exactly as shown in AIN>"
```
```bash
link-org.sh acme "Acme Clinic"
```
Then: `add-user.sh someone@acme.org "Their Name" observer acme`

---

## Reference
- **Roles:** `observer`, `regular`, `admin`, `sysadmin` → become `ain-role-*` groups
- **Org slugs → groups:** `<slug>` → `ain-org-<slug>` (current: bcom, obfh, axuslab1, axusoffice1, beacon)
- **App access:** every AIN user also gets the `app-insights` group (handled automatically)
- Group assignment on enrollment is finished by the reconcile cron on the Hub box
  (`infra/authentik/reconcile-invite-groups.sh`, runs every minute).
