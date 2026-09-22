# Deploying grace.harrys.monster

Same pattern as send.harrys.monster: a Worker with static assets and a
Durable Object, custom domain declared in `wrangler.jsonc`, so the first
deploy also creates the DNS record and certificate.

```bash
npx wrangler deploy
```

Once, set Grace's key and hand her the link it prints:

```bash
KEY=$(openssl rand -base64 18 | tr -d '/+=')
printf %s "$KEY" | npx wrangler secret put EDIT_KEY
echo "https://grace.harrys.monster/#$KEY"
```

Re-run those three lines to rotate the key; every old copy stops working on
its next edit.

Check after a deploy:

```bash
curl -sI https://grace.harrys.monster | grep -i content-security-policy
curl -s https://grace.harrys.monster/api/state
curl -s -X POST https://grace.harrys.monster/api/op \
  -H 'Content-Type: application/json' -d '{"op":"add","name":"x"}'
```

The last one must answer `{"error":"Unauthorized"}` with a 401: an unkeyed
request can never write.

Then visit the site with an ad-blocker off and confirm the pageview appears in
the analytics dashboard's Live tab (per `analytics.harrys.monster/SNIPPET.md`).

## If wrangler reports "The request to Cloudflare's API timed out"

On Harry's desktop the first nameserver in `/etc/resolv.conf` does not answer.
Either fix the resolver or run:

```bash
RES_OPTIONS="timeout:1 attempts:1" CLOUDFLARE_ACCOUNT_ID=<account id from wrangler whoami> npx wrangler deploy
```

## Publish the repo

The sibling sites are public repos under the same account.

```bash
gh repo create Hazzer890/grace.harrys.monster --public --source=. --push
```
