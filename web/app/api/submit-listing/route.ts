import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/email/send";

interface ListingSubmission {
  businessName: string;
  contactName: string;
  contactNumber: string;
  email: string;
  address: string;
  city: string;
  postcode: string;
  category: string;
  location: string;
  description?: string;
  website?: string;
  isFreeService: boolean;
}

export async function POST(request: Request) {
  try {
    const data: ListingSubmission = await request.json();

    const requiredFields = [
      "businessName",
      "contactName",
      "contactNumber",
      "email",
      "address",
      "city",
      "postcode",
      "category",
      "location",
    ];

    for (const field of requiredFields) {
      if (!data[field as keyof ListingSubmission]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 },
        );
      }
    }

    const emailContent = `
New Listing Submission - Legal Shaman
================================================

BUSINESS INFORMATION
--------------------
Business Name: ${data.businessName}
Category: ${data.category}
Region: ${data.location}
Service Type: ${data.isFreeService ? "FREE SERVICE" : "Paid Service"}
Website: ${data.website || "Not provided"}

Description:
${data.description || "Not provided"}

CONTACT INFORMATION
-------------------
Contact Name: ${data.contactName}
Contact Number: ${data.contactNumber}
Email: ${data.email}

PHYSICAL ADDRESS
----------------
${data.address}
${data.city}
${data.postcode}

================================================
Submitted: ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London" })}

Please review this listing and approve/reject accordingly.
    `.trim();

    const result = await sendEmail({
      to: "Saif@greysandgreens.co.uk",
      subject: `New Listing Submission: ${data.businessName}`,
      text: emailContent,
      replyTo: data.email,
    });

    if (!result.ok) {
      console.error("Failed to send listing notification email");
    }

    return NextResponse.json({
      success: true,
      message: "Listing submitted successfully. It will be reviewed shortly.",
    });
  } catch (error) {
    console.error("Error processing listing submission:", error);
    return NextResponse.json(
      { error: "Failed to process submission" },
      { status: 500 },
    );
  }
}
