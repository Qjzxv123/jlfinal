export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen gradient-bg p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl p-10">
        <h1 className="text-4xl font-bold text-gray-800 mb-6">Privacy Policy</h1>
        
        <div className="space-y-6 text-gray-700">
          <section>
            <h2 className="text-2xl font-semibold text-gray-800 mb-3">Information Collection</h2>
            <p>
              We collect information that you provide directly to us, including when you create an account,
              place an order, or communicate with us. This may include your name, email address, phone number,
              and payment information.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-800 mb-3">How We Use Your Information</h2>
            <p>
              We use the information we collect to provide, maintain, and improve our services, process
              transactions, send you technical notices and support messages, and respond to your comments
              and questions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-800 mb-3">Information Sharing</h2>
            <p>
              We do not share your personal information with third parties except as described in this policy.
              We may share information with service providers who perform services on our behalf, such as
              payment processing and order fulfillment.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-800 mb-3">Data Security</h2>
            <p>
              We take reasonable measures to help protect your personal information from loss, theft, misuse,
              unauthorized access, disclosure, alteration, and destruction.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-800 mb-3">Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us through our website.
            </p>
          </section>
        </div>

        <div className="mt-8 text-center">
          <a
            href="/"
            className="inline-block bg-jl-green text-white font-semibold py-2 px-6 rounded-lg hover:bg-jl-green/90 transition-colors"
          >
            Back to Home
          </a>
        </div>

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>&copy; 2025 J&L Tools. All rights reserved.</p>
          <p className="mt-2">Last updated: December 2025</p>
        </div>
      </div>
    </main>
  )
}
