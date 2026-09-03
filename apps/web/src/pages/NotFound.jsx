import { Link } from "react-router-dom";
import { Button, Card } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";

/* Designed 404, not a bare string. */
export default function NotFound() {
  return (
    <Card>
      <EmptyState
        art="chart"
        title="That page does not exist"
        body="The link may be out of date, or the screen may belong to a portal you are not signed in to."
        action={
          <Link to="/teacher">
            <Button variant="primary" iconRight="arrowRight">
              Back to the dashboard
            </Button>
          </Link>
        }
      />
    </Card>
  );
}
