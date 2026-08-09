CREATE TABLE "wallet_card_payloads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"barcode_format" text,
	"payload_encrypted" integer DEFAULT 0 NOT NULL,
	"payload" text NOT NULL,
	"front_image_key" text,
	"back_image_key" text,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"kind_hint" text,
	"storage_object_key" text,
	"encryption_version" text,
	"encrypted_metadata" text,
	"wrapped_dek" text,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_card_payloads" ADD CONSTRAINT "wallet_card_payloads_item_id_wallet_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."wallet_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_card_payloads_item_idx" ON "wallet_card_payloads" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "wallet_items_tenant_owner_idx" ON "wallet_items" USING btree ("tenant_id","owner_user_id");