// app/about/page.tsx
import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Plane, BarChart3, Users, Shield, Target, Zap } from "lucide-react"

// Using Plane icon as Drone
const Drone = Plane

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link href="/">
              <Image src="/images/plnt-logo.svg" alt="PLNT Logo" width={150} height={50} className="h-12 w-auto" priority />
            </Link>
          </div>
          <nav className="hidden md:flex space-x-8">
            <Link href="/" className="text-gray-700 hover:text-green-700 font-medium">
              Home
            </Link>
            <Link href="/#services" className="text-gray-700 hover:text-green-700 font-medium">
              Services
            </Link>
            <Link href="/#technology" className="text-gray-700 hover:text-green-700 font-medium">
              Technology
            </Link>
            <Link href="/about" className="text-gray-700 hover:text-green-700 font-medium">
              About
            </Link>
            <Link href="/#contact" className="text-gray-700 hover:text-green-700 font-medium">
              Contact
            </Link>
          </nav>
          <Link href="/dashboard">
            <Button className="bg-green-700 hover:bg-green-800 text-white">
              <BarChart3 className="w-4 h-4 mr-2" />
              Dashboard
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-gray-50 to-green-50 py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl font-bold text-gray-900 mb-6">About PLNT</h1>
            <p className="text-xl text-gray-600 leading-relaxed">
              We're revolutionizing plant nursery management with cutting-edge drone technology and AI-powered analytics. 
              Our mission is to help nursery operators optimize their operations, reduce costs, and grow better plants.
            </p>
          </div>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">Our Mission</h2>
              <p className="text-lg text-gray-600 mb-4">
                PLNT was founded with a simple belief: modern technology should make nursery management easier, not harder. 
                We combine drone surveying, computer vision, and data analytics to give nursery operators unprecedented 
                insights into their operations.
              </p>
              <p className="text-lg text-gray-600 mb-4">
                By automating plant counting and health monitoring, we help nurseries save time, reduce labor costs, 
                and make data-driven decisions that improve their bottom line.
              </p>
              <Link href="/dashboard">
                <Button className="bg-green-700 hover:bg-green-800 text-white">
                  <Drone className="w-4 h-4 mr-2" />
                  Try Our Platform
                </Button>
              </Link>
            </div>
            <div className="relative">
              <Image
                src="/images/nursery-aerial.png"
                alt="Drone surveying a plant nursery"
                width={600}
                height={400}
                className="rounded-lg shadow-xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Core Values</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Everything we do is guided by these principles
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Card className="text-center">
              <CardContent className="p-6">
                <Target className="w-12 h-12 text-green-700 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Precision</h3>
                <p className="text-gray-600">
                  99.5% accuracy in plant counting with industry-leading computer vision algorithms
                </p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="p-6">
                <Zap className="w-12 h-12 text-green-700 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Innovation</h3>
                <p className="text-gray-600">
                  Continuously improving our technology to meet the evolving needs of modern nurseries
                </p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="p-6">
                <Shield className="w-12 h-12 text-green-700 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Reliability</h3>
                <p className="text-gray-600">
                  Trusted by nurseries across the country for mission-critical inventory management
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Team</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Experts in agriculture, drone technology, and artificial intelligence
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-32 h-32 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
                <Users className="w-16 h-16 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold">Porter Comstock</h3>
              <p className="text-gray-600">Founder & CEO</p>
              <p className="text-sm text-gray-500 mt-2">
                Agricultural technology expert with 5+ years in precision farming
              </p>
            </div>
            <div className="text-center">
              <div className="w-32 h-32 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
                <Users className="w-16 h-16 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold">Technical Team</h3>
              <p className="text-gray-600">Engineering</p>
              <p className="text-sm text-gray-500 mt-2">
                Computer vision and drone technology specialists
              </p>
            </div>
            <div className="text-center">
              <div className="w-32 h-32 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
                <Users className="w-16 h-16 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold">Advisory Board</h3>
              <p className="text-gray-600">Industry Experts</p>
              <p className="text-sm text-gray-500 mt-2">
                Leading nursery operators and agricultural consultants
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-green-800">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">Ready to Transform Your Nursery?</h2>
          <p className="text-xl text-green-100 mb-8 max-w-2xl mx-auto">
            Join the growing number of nurseries using PLNT to optimize their operations
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/dashboard">
              <Button size="lg" className="bg-white text-green-700 hover:bg-gray-100">
                <Drone className="w-5 h-5 mr-2" />
                Try It Free
              </Button>
            </Link>
            <Link href="/#contact">
              <Button
                size="lg"
                variant="outline"
                className="border-white text-white bg-transparent hover:bg-green-700 hover:border-green-700"
              >
                Contact Sales
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-green-900 text-white py-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <Image
                  src="/images/plnt-logo.svg"
                  alt="PLNT Logo"
                  width={150}
                  height={50}
                  className="h-12 w-auto brightness-0 invert"
                  priority
                />
              </div>
              <p className="text-white/70">
                Advanced drone technology for precision plant counting and nursery analytics.
              </p>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Services</h4>
              <ul className="space-y-2 text-white/70">
                <li>Plant Counting</li>
                <li>Plant Count Trends</li>
                <li>Flight Planning</li>
                <li>Business Intelligence</li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Technology</h4>
              <ul className="space-y-2 text-white/70">
                <li>Drone Integration</li>
                <li>AI Recognition</li>
                <li>Weather Monitoring</li>
                <li>
                  <Link href="/dashboard" className="hover:text-white">
                    Flight Planner
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-white/70">
                <li>(310) 890-0846</li>
                <li>porter@plnt.net</li>
                <li>Documentation</li>
                <li>Training Videos</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-green-800 mt-8 pt-8 text-center text-white/70">
            <p>&copy; 2024-2026 PLNT Network LLC. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}