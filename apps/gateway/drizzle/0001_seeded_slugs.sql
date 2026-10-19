CREATE TABLE "seeded_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL
);
