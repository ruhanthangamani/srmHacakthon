import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Factory, Recycle, TrendingUp, MapPin, CheckCircle } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { DEMO_FACTORIES } from "@/data/demoData";

export default function Landing() {
  const navigate = useNavigate();
  const addFactory = useAppStore((state) => state.addFactory);

  const handleDemoLoad = () => {
    DEMO_FACTORIES.forEach(factory => addFactory(factory));
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto space-y-8">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-primary/10 rounded-2xl">
              <Factory className="h-16 w-16 text-primary" />
            </div>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            Industrial Waste{" "}
            <span className="text-primary">Matching Portal</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Connect waste generators with material receivers. 
            Optimize sustainability, reduce costs, and close the circular economy loop.
          </p>

          <div className="flex flex-wrap gap-4 justify-center pt-4">
            <Button size="lg" asChild className="h-12 px-8">
              <Link to="/auth/register">Get Started</Link>
            </Button>
            <Button size="lg" variant="outline" onClick={handleDemoLoad} className="h-12 px-8">
              See Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <Recycle className="h-10 w-10 text-accent mb-4" />
            <h3 className="font-semibold text-lg mb-2">Circular Economy</h3>
            <p className="text-sm text-muted-foreground">
              Turn waste into valuable resources. Match generators with receivers for sustainable material flow.
            </p>
          </Card>

          <Card className="p-6 hover:shadow-lg transition-shadow">
            <TrendingUp className="h-10 w-10 text-primary mb-4" />
            <h3 className="font-semibold text-lg mb-2">Cost Optimization</h3>
            <p className="text-sm text-muted-foreground">
              Reduce disposal costs and material procurement expenses through intelligent matching.
            </p>
          </Card>

          <Card className="p-6 hover:shadow-lg transition-shadow">
            <MapPin className="h-10 w-10 text-info mb-4" />
            <h3 className="font-semibold text-lg mb-2">Local Connections</h3>
            <p className="text-sm text-muted-foreground">
              Find nearby partners to minimize transport costs and carbon emissions.
            </p>
          </Card>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
        <div className="max-w-3xl mx-auto space-y-6">
          {[
            { step: 1, title: "Register Your Factory", desc: "Sign up as a waste generator, material receiver, or both." },
            { step: 2, title: "Specify Requirements", desc: "Detail your waste output or material needs with technical specifications." },
            { step: 3, title: "Get Matched", desc: "Our algorithm finds optimal matches based on compatibility, distance, and cost." },
            { step: 4, title: "Connect & Trade", desc: "Review matches, analyze cycles, and establish sustainable partnerships." },
          ].map((item) => (
            <div key={item.step} className="flex gap-4 items-start">
              <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
                {item.step}
              </div>
              <div className="flex-1 pt-1">
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
              <CheckCircle className="h-5 w-5 text-accent flex-shrink-0 mt-1" />
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-16">
        <Card className="p-12 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Transform Your Waste into Value?</h2>
          <p className="text-lg mb-8 opacity-90">Join the circular economy revolution today.</p>
          <Button size="lg" variant="secondary" asChild className="h-12 px-8">
            <Link to="/auth/register">Create Account</Link>
          </Button>
        </Card>
      </section>
    </div>
  );
}
