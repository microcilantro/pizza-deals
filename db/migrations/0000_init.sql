CREATE TYPE "public"."crust_class" AS ENUM('standard', 'thin', 'specialty');--> statement-breakpoint
CREATE TYPE "public"."deal_kind" AS ENUM('single_pizza', 'multi_pizza', 'bundle');--> statement-breakpoint
CREATE TYPE "public"."discount_scope" AS ENUM('pizza', 'order');--> statement-breakpoint
CREATE TYPE "public"."fulfillment" AS ENUM('carryout', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."pizza_shape" AS ENUM('round', 'rect');--> statement-breakpoint
CREATE TYPE "public"."pricing_basis" AS ENUM('advertised', 'derived_from_discount');--> statement-breakpoint
CREATE TYPE "public"."scrape_status" AS ENUM('ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."topping_policy" AS ENUM('exact', 'up_to', 'unlimited', 'specialty_fixed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chains" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"menu_url" text NOT NULL,
	"deals_url" text NOT NULL,
	CONSTRAINT "chains_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "component_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"category" text NOT NULL,
	"descriptor" text NOT NULL,
	"menu_price_usd" numeric(6, 2) NOT NULL,
	"pricing_locale" text DEFAULT 'san-diego-ca' NOT NULL,
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crust_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"crust_name" text NOT NULL,
	"crust_class" "crust_class" NOT NULL,
	"observed_upcharge_usd" numeric(6, 2),
	"source_url" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crust_options_chain_name_uq" UNIQUE("chain_id","crust_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crust_size_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"crust_option_id" integer NOT NULL,
	"diameter_in" numeric(4, 2) NOT NULL,
	"orderable" boolean NOT NULL,
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crust_size_availability_uq" UNIQUE("crust_option_id","diameter_in")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_other_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"category" text NOT NULL,
	"descriptor" text NOT NULL,
	"component_value_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_pizza_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"size_label" text NOT NULL,
	"shape" "pizza_shape" DEFAULT 'round' NOT NULL,
	"diameter_in" numeric(4, 2),
	"length_in" numeric(4, 2),
	"width_in" numeric(4, 2),
	"size_observation_id" integer,
	"crust_option_id" integer NOT NULL,
	"menu_price_id" integer,
	"topping_count" integer,
	"topping_policy" "topping_policy" DEFAULT 'exact' NOT NULL,
	"premium_toppings" boolean DEFAULT false NOT NULL,
	CONSTRAINT "deal_pizza_items_dims_match_shape" CHECK (("deal_pizza_items"."shape" = 'round' AND "deal_pizza_items"."diameter_in" IS NOT NULL)
          OR ("deal_pizza_items"."shape" = 'rect' AND "deal_pizza_items"."length_in" IS NOT NULL AND "deal_pizza_items"."width_in" IS NOT NULL)),
	CONSTRAINT "deal_pizza_items_qty_positive" CHECK ("deal_pizza_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"price_usd" numeric(6, 2),
	"discount_percent" numeric(5, 2),
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"deal_name" text NOT NULL,
	"kind" "deal_kind" NOT NULL,
	"fulfillment" "fulfillment" NOT NULL,
	"price_usd" numeric(6, 2),
	"discount_percent" numeric(5, 2),
	"discount_scope" "discount_scope",
	"pricing_locale" text DEFAULT 'san-diego-ca' NOT NULL,
	"promo_code" text,
	"valid_from" date,
	"valid_through" date,
	"source_url" text NOT NULL,
	"national" boolean DEFAULT true NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	CONSTRAINT "deals_chain_fingerprint_uq" UNIQUE("chain_id","fingerprint"),
	CONSTRAINT "deals_price_or_discount" CHECK ("deals"."price_usd" IS NOT NULL OR "deals"."discount_percent" IS NOT NULL),
	CONSTRAINT "deals_discount_scope_set" CHECK ("deals"."discount_percent" IS NULL OR "deals"."discount_scope" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_fee_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"fee_usd" numeric(6, 2) NOT NULL,
	"pricing_locale" text DEFAULT 'san-diego-ca' NOT NULL,
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_pizza_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"size_label" text NOT NULL,
	"crust_option_id" integer NOT NULL,
	"topping_count" integer,
	"menu_price_usd" numeric(6, 2) NOT NULL,
	"pricing_locale" text DEFAULT 'san-diego-ca' NOT NULL,
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "scrape_status" NOT NULL,
	"deals_found" integer,
	"error_message" text,
	"screenshot_path" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "size_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"size_label" text NOT NULL,
	"crust_option_id" integer,
	"shape" "pizza_shape" DEFAULT 'round' NOT NULL,
	"diameter_in" numeric(4, 2),
	"length_in" numeric(4, 2),
	"width_in" numeric(4, 2),
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "size_observations_dims_match_shape" CHECK (("size_observations"."shape" = 'round' AND "size_observations"."diameter_in" IS NOT NULL AND "size_observations"."length_in" IS NULL AND "size_observations"."width_in" IS NULL)
          OR ("size_observations"."shape" = 'rect' AND "size_observations"."diameter_in" IS NULL AND "size_observations"."length_in" IS NOT NULL AND "size_observations"."width_in" IS NOT NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "component_values" ADD CONSTRAINT "component_values_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crust_options" ADD CONSTRAINT "crust_options_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crust_size_availability" ADD CONSTRAINT "crust_size_availability_crust_option_id_crust_options_id_fk" FOREIGN KEY ("crust_option_id") REFERENCES "public"."crust_options"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_other_items" ADD CONSTRAINT "deal_other_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_other_items" ADD CONSTRAINT "deal_other_items_component_value_id_component_values_id_fk" FOREIGN KEY ("component_value_id") REFERENCES "public"."component_values"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_pizza_items" ADD CONSTRAINT "deal_pizza_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_pizza_items" ADD CONSTRAINT "deal_pizza_items_size_observation_id_size_observations_id_fk" FOREIGN KEY ("size_observation_id") REFERENCES "public"."size_observations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_pizza_items" ADD CONSTRAINT "deal_pizza_items_crust_option_id_crust_options_id_fk" FOREIGN KEY ("crust_option_id") REFERENCES "public"."crust_options"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_pizza_items" ADD CONSTRAINT "deal_pizza_items_menu_price_id_menu_pizza_prices_id_fk" FOREIGN KEY ("menu_price_id") REFERENCES "public"."menu_pizza_prices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_price_history" ADD CONSTRAINT "deal_price_history_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_fee_observations" ADD CONSTRAINT "delivery_fee_observations_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "menu_pizza_prices" ADD CONSTRAINT "menu_pizza_prices_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "menu_pizza_prices" ADD CONSTRAINT "menu_pizza_prices_crust_option_id_crust_options_id_fk" FOREIGN KEY ("crust_option_id") REFERENCES "public"."crust_options"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "size_observations" ADD CONSTRAINT "size_observations_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "size_observations" ADD CONSTRAINT "size_observations_crust_option_id_crust_options_id_fk" FOREIGN KEY ("crust_option_id") REFERENCES "public"."crust_options"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
