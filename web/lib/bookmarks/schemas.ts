import { z } from "zod";
import { RESULT_SOURCES } from "@/lib/search-events/types";

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

export const RegisterSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(255).optional(),
    email: z.string().trim().email("Enter a valid email").max(255),
    password: passwordField,
    confirmPassword: z.string().min(1, "Confirm your password"),
    captchaToken: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const LoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: passwordField,
  captchaToken: z.string().optional(),
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
