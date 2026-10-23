CREATE TABLE "chat_usage_daily" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "chat_usage_daily_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "chat_usage_daily" ADD CONSTRAINT "chat_usage_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;