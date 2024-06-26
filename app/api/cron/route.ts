import { NextResponse } from "next/server";

import { getLowestPrice, getHighestPrice, getAveragePrice, getEmailNotifType, Notification } from "@/lib/utils";
import { connectToDB } from "@/lib/mongoose";
import Product from "@/lib/models/product.model";
import { scrapeAmazonProduct } from "@/lib/scraper";
import { generateEmailBody, sendEmail } from "@/lib/nodemailer";
import { User } from "@/types";
import { deleteUserAlert } from '@/lib/actions'

//export const maxDuration = 10; // This function can run for a maximum of 300 seconds
//export const dynamic = "force-dynamic";
//export const revalidate = 0;

export async function GET(request: Request) {
  try {
    await connectToDB();

    const products = await Product.find({});

    if (!products) throw new Error("No product fetched");

    // ======================== 1 SCRAPE LATEST PRODUCT DETAILS & UPDATE DB
    const updatedProducts = await Promise.all(
      products.map(async (currentProduct) => {
        // Scrape product
        const scrapedProduct = await scrapeAmazonProduct(currentProduct.url);

        if (!scrapedProduct) return;

        const updatedPriceHistory = [
          ...currentProduct.priceHistory,
          {
            price: scrapedProduct.currentPrice,
          },
        ];

        const product = {
          ...scrapedProduct,
          priceHistory: updatedPriceHistory,
          lowestPrice: getLowestPrice(updatedPriceHistory),
          highestPrice: getHighestPrice(updatedPriceHistory),
          averagePrice: getAveragePrice(updatedPriceHistory),
        };        

        // ======================== 2 CHECK EACH PRODUCT'S STATUS & SEND EMAIL ACCORDINGLY
        const emailNotifType = getEmailNotifType(
          scrapedProduct,
          currentProduct
        );
        if (emailNotifType) {

            // Update Products in DB only if prices have changed
          const updatedProduct = await Product.findOneAndUpdate(
            {
              url: product.url,
            },
            product
          );
          if (updatedProduct.users.length > 0) {
            const productInfo = {
              title: updatedProduct.title,
              url: updatedProduct.url,
              price: 0
            };
            updatedProduct.users.map(async(user: User) => {
              if(scrapedProduct.currentPrice <= user.myPrice) {
                productInfo.price = user.myPrice
                // Construct emailContent
                const emailContent = await generateEmailBody(productInfo, Notification.USERPRICE_MET as keyof typeof Notification);
                // Send email notification
                await sendEmail(emailContent, [user.email]);
                await deleteUserAlert(currentProduct, user.email);
              }
            })
            
            // Construct emailContent
            //const emailContent = await generateEmailBody(productInfo, emailNotifType);
            // Get array of user emails
            //const userEmails = updatedProduct.users.map((user: any) => user.email);
            //// Send email notification
            //await sendEmail(emailContent, userEmails);
          }
          return updatedProduct;
        }
      })
    );

    return NextResponse.json({
      message: "Ok",
      data: updatedProducts,
    });
  } catch (error: any) {
    throw new Error(`Failed to get all products: ${error.message}`);
  }
}