import { NextResponse } from "next/server";

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

    // Validate required fields
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
          { status: 400 }
        );
      }
    }

    // Format the email content
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

    // Send email using fetch to a mail service
    // For now, we'll use Resend if available, otherwise log the submission
    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Legal Shaman <noreply@resend.dev>",
          to: "Saif@greysandgreens.co.uk",
          subject: `New Listing Submission: ${data.businessName}`,
          text: emailContent,
        }),
      });

      if (!emailResponse.ok) {
        console.error("Failed to send email via Resend");
      }
    } else {
      // Log to console for development/testing
      console.log("=== NEW LISTING SUBMISSION ===");
      console.log("To: Saif@greysandgreens.co.uk");
      console.log(emailContent);
      console.log("==============================");
    }

    return NextResponse.json({
      success: true,
      message: "Listing submitted successfully. It will be reviewed shortly.",
    });
  } catch (error) {
    console.error("Error processing listing submission:", error);
    return NextResponse.json(
      { error: "Failed to process submission" },
      { status: 500 }
    );
  }
}
