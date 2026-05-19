"use client";

import React from "react"

import { useState } from "react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2 } from "lucide-react";
import { categories } from "@/lib/data";

const locations = [
  "London",
  "Birmingham",
  "Manchester",
  "Leeds",
  "Glasgow",
  "Liverpool",
  "Bristol",
  "Sheffield",
  "Edinburgh",
  "Cardiff",
  "Other",
];

export default function SubmitListingPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const data = {
      businessName: formData.get("businessName"),
      contactName: formData.get("contactName"),
      contactNumber: formData.get("contactNumber"),
      email: formData.get("email"),
      address: formData.get("address"),
      city: formData.get("city"),
      postcode: formData.get("postcode"),
      category: formData.get("category"),
      location: formData.get("location"),
      description: formData.get("description"),
      website: formData.get("website"),
      isFreeService: formData.get("isFreeService") === "on",
    };

    try {
      const response = await fetch("/api/submit-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error("Failed to submit listing");
      }

      setIsSubmitted(true);
    } catch {
      setError("There was an error submitting your listing. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <CheckCircle2 className="mb-4 h-16 w-16 text-green-600" />
              <h1 className="mb-2 text-2xl font-semibold text-foreground">
                Submission Received
              </h1>
              <p className="text-muted-foreground">
                Thank you for submitting your business to Legal Shaman. 
                Our team will review your listing and get back to you within 2-3 business days.
              </p>
              <Button className="mt-6" asChild>
                <a href="/">Return to Directory</a>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">List Your Business</CardTitle>
            <CardDescription>
              Submit your legal service to Legal Shaman. All submissions are reviewed 
              by our team before being published to ensure quality and relevance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Business Information */}
              <div className="space-y-4">
                <h3 className="font-medium text-foreground">Business Information</h3>
                
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name *</Label>
                  <Input
                    id="businessName"
                    name="businessName"
                    placeholder="e.g. Smith & Partners Solicitors"
                    required
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <Select name="category" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(categories).map(([group, items]) => (
                          <div key={group}>
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                              {group}
                            </div>
                            {items.map((item) => (
                              <SelectItem key={item.slug} value={item.slug}>
                                {item.name}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="location">Region *</Label>
                    <Select name="location" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a region" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((location) => (
                          <SelectItem key={location} value={location}>
                            {location}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Brief description of your services..."
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Website (optional)</Label>
                  <Input
                    id="website"
                    name="website"
                    type="url"
                    placeholder="https://www.example.com"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isFreeService"
                    name="isFreeService"
                    className="h-4 w-4 rounded border-border"
                  />
                  <Label htmlFor="isFreeService" className="font-normal">
                    This is a free legal service (charity, pro bono, legal aid)
                  </Label>
                </div>
              </div>

              {/* Contact Information */}
              <div className="space-y-4 border-t border-border pt-6">
                <h3 className="font-medium text-foreground">Contact Information</h3>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="contactName">Contact Name *</Label>
                    <Input
                      id="contactName"
                      name="contactName"
                      placeholder="Full name"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contactNumber">Contact Number *</Label>
                    <Input
                      id="contactNumber"
                      name="contactNumber"
                      type="tel"
                      placeholder="e.g. 020 1234 5678"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address *</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="contact@example.com"
                    required
                  />
                </div>
              </div>

              {/* Physical Address */}
              <div className="space-y-4 border-t border-border pt-6">
                <h3 className="font-medium text-foreground">Physical Address *</h3>

                <div className="space-y-2">
                  <Label htmlFor="address">Street Address *</Label>
                  <Input
                    id="address"
                    name="address"
                    placeholder="123 High Street"
                    required
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="city">City/Town *</Label>
                    <Input
                      id="city"
                      name="city"
                      placeholder="London"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="postcode">Postcode *</Label>
                    <Input
                      id="postcode"
                      name="postcode"
                      placeholder="SW1A 1AA"
                      required
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="border-t border-border pt-6">
                <p className="mb-4 text-xs text-muted-foreground">
                  By submitting this form, you confirm that all information provided is accurate. 
                  All listings are subject to review and approval by our team.
                </p>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit for Review"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
