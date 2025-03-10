import { getYear } from "@/lib/utils";
import { Heart } from "lucide-react";
import React from "react";

const Footer = () => {
  return (
    <footer className="font-light text-sm py-6">
      <div className="container mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="text-center md:text-left">
            <p>
              {" "}
              Copyright &copy; {getYear()}{" "}
              <a
                className="text-rose-500 hover:text-amber-500 transition duration-300"
                href="https://fadysoliman.name"
                target="blank"
              >
                Fady Soliman
              </a>
              , All rights reserved.{" "}
            </p>
          </div>
          <div className="text-center md:text-right">
            <p className="flex flex-row items-center justify-center md:justify-end space-x-1">
              <span>Built with</span>
              <span>
                <Heart size={16} className="text-red-500 animate-pulse" />{" "}
              </span>
              <span>using</span>
              <a
                href="https://nextjs.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-rose-500 hover:text-amber-500 transition duration-300"
              >
                Next.js
              </a>
              <span>and</span>
              <a
                href="https://tailwindcss.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-rose-500 hover:text-amber-500 transition duration-300"
              >
                Tailwind CSS
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
