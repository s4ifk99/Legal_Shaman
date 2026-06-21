import { z } from "zod";
import { RESULT_SOURCES } from "@/lib/search-events/types";

export const RegisterSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  email: z.string().trim().email("Enter a valid email").max(255),
});

export const LoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
});

export const BookmarkSchema = z.object({
  entityId: z.string().trim().min(1).max(128),
  resultSource: z.enum(RESULT_SOURCES),
  businessName: z.string().trim().min(1).max(512),
});

export const BookmarkDeleteSchema = z.object({
  entityId: z.string().trim().min(1).max(128),
  resultSource: z.enum(RESULT_SOURCES),
});
